import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  ScrollView,
  Animated,
  PanResponder,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../supabaseConfig';
import { getDrivers, addDriver, updateDriver, deleteDriver, createDriverAccount, getDriverByEmail, Driver } from '../services/driverService';
import { convertImageToBase64 } from '../services/userService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerRow } from '../components/Shimmer';

type DriverFormValues = {
  fullName: string;
  age: string;
  address: string;
  aadhaarCard: string;
  panCard: string;
  vehicleOwned: string;
  photoUrl: string;
  email: string;
  licenseNumber: string;
  licenseExpiry: string;
};

const emptyForm: DriverFormValues = { fullName: '', age: '', address: '', aadhaarCard: '', panCard: '', vehicleOwned: '', photoUrl: '', email: '', licenseNumber: '', licenseExpiry: '' };

interface DriverFormProps {
  f: DriverFormValues;
  setF: (k: string, v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  submitLabel: string;
  saving: boolean;
  onPickImage: (isEdit: boolean) => void;
}

function DriverForm({ f, setF, onSave, onCancel, submitLabel, saving, onPickImage }: DriverFormProps) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <TouchableOpacity style={fms.photoBtn} onPress={() => onPickImage(submitLabel === 'Save Changes')} activeOpacity={0.8}>
        {f.photoUrl ? (
          <Image source={{ uri: f.photoUrl }} style={fms.photoImg} resizeMode="cover" />
        ) : (
          <View style={fms.photoPlaceholder}>
            <Text style={fms.photoPlaceholderIcon}>📷</Text>
            <Text style={fms.photoPlaceholderText}>Add Photo</Text>
          </View>
        )}
      </TouchableOpacity>

      {[
        { key: 'fullName', label: 'Full Name *', autoCapitalize: 'words' as const, placeholder: 'Driver full name' },
        { key: 'age', label: 'Age * (18–80)', keyboardType: 'numeric' as const, placeholder: '25' },
        { key: 'email', label: 'Email (for account linking)', keyboardType: 'email-address' as const, autoCapitalize: 'none' as const, placeholder: 'driver@example.com' },
        { key: 'vehicleOwned', label: 'Vehicle *', autoCapitalize: 'characters' as const, placeholder: 'HR26AB1234' },
        { key: 'aadhaarCard', label: 'Aadhaar * (12 digits)', keyboardType: 'numeric' as const, maxLength: 12, placeholder: '123456789012' },
        { key: 'panCard', label: 'PAN Card *', autoCapitalize: 'characters' as const, maxLength: 10, placeholder: 'ABCDE1234F' },
        { key: 'licenseNumber', label: 'License Number (optional)', autoCapitalize: 'characters' as const, placeholder: 'DL-1420110012345' },
        { key: 'licenseExpiry', label: 'License Expiry (optional, YYYY-MM-DD)', placeholder: '2027-01-31' },
      ].map(field => (
        <View key={field.key} style={{ marginBottom: Spacing[3] }}>
          <Text style={fms.label}>{field.label}</Text>
          <TextInput
            style={fms.input}
            value={(f as any)[field.key]}
            onChangeText={v => setF(field.key, v)}
            autoCapitalize={field.autoCapitalize ?? 'sentences'}
            keyboardType={field.keyboardType ?? 'default'}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            placeholderTextColor={Colors.textMuted}
          />
        </View>
      ))}

      <View style={{ marginBottom: Spacing[3] }}>
        <Text style={fms.label}>Address *</Text>
        <TextInput
          style={[fms.input, { height: 80, textAlignVertical: 'top' }]}
          value={f.address}
          onChangeText={v => setF('address', v)}
          multiline
          numberOfLines={3}
          placeholder="Full address"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="sentences"
        />
      </View>

      <View style={fms.btns}>
        <TouchableOpacity style={fms.cancelBtn} onPress={onCancel} disabled={saving}>
          <Text style={fms.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={fms.saveBtn} onPress={onSave} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={fms.saveText}>{submitLabel}</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default function DriverManagementScreen() {
  const navigation = useNavigation<any>();
  const user = auth.currentUser;
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState<(Driver & { id: string }) | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingLogin, setCreatingLogin] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [credentialsModal, setCredentialsModal] = useState<{ email: string; password?: string; linkedExisting?: boolean } | null>(null);

  const addSwipeY = useRef(new Animated.Value(0)).current;
  const addModalPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_, gs) => { if (gs.dy > 0) addSwipeY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 120 || gs.vy > 0.5) {
        Animated.timing(addSwipeY, { toValue: 800, duration: 200, useNativeDriver: true })
          .start(() => { addSwipeY.setValue(0); setAddModal(false); });
      } else {
        Animated.spring(addSwipeY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const viewSwipeY = useRef(new Animated.Value(0)).current;
  const viewModalPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_, gs) => { if (gs.dy > 0) viewSwipeY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 120 || gs.vy > 0.5) {
        Animated.timing(viewSwipeY, { toValue: 800, duration: 200, useNativeDriver: true })
          .start(() => { viewSwipeY.setValue(0); setViewModal(false); setIsEditing(false); });
      } else {
        Animated.spring(viewSwipeY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const load = async () => {
    setLoading(true);
    try {
      const data = await getDrivers();
      setDrivers(data);
    } catch (e) {
      Alert.alert('Error', 'Failed to load drivers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = drivers.filter(d =>
    d.fullName.toLowerCase().includes(searchQ.toLowerCase()) ||
    (d.vehicleOwned ?? '').toLowerCase().includes(searchQ.toLowerCase())
  );

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));
  const setEditField = (key: string, val: string) => setEditForm(prev => ({ ...prev, [key]: val }));

  const pickImage = async (isEdit: boolean) => {
    Alert.alert('Photo', 'Choose source:', [
      { text: 'Camera', onPress: () => capturePhoto(isEdit) },
      { text: 'Gallery', onPress: () => fromGallery(isEdit) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const capturePhoto = async (isEdit: boolean) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission Denied', 'Camera access required.'); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!res.canceled && res.assets[0]) {
      const b64 = await convertImageToBase64(res.assets[0].uri);
      isEdit ? setEditField('photoUrl', b64) : setField('photoUrl', b64);
    }
  };

  const fromGallery = async (isEdit: boolean) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission Denied', 'Gallery access required.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!res.canceled && res.assets[0]) {
      const b64 = await convertImageToBase64(res.assets[0].uri);
      isEdit ? setEditField('photoUrl', b64) : setField('photoUrl', b64);
    }
  };

  const validate = (f: typeof emptyForm) => {
    if (!f.fullName.trim() || !f.age.trim() || !f.address.trim() || !f.aadhaarCard.trim() || !f.panCard.trim() || !f.vehicleOwned.trim()) return 'Please fill all required fields.';
    if (!/^\d+$/.test(f.age) || parseInt(f.age) < 18 || parseInt(f.age) > 80) return 'Age must be between 18 and 80.';
    if (!/^\d{12}$/.test(f.aadhaarCard.replace(/\s/g, ''))) return 'Aadhaar must be exactly 12 digits.';
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(f.panCard.toUpperCase())) return 'Invalid PAN card format (e.g. ABCDE1234F).';
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Invalid email address.';
    if (f.licenseExpiry.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(f.licenseExpiry.trim())) return 'License expiry must be in YYYY-MM-DD format.';
    return null;
  };

  const handleAdd = async () => {
    const err = validate(form);
    if (err) { Alert.alert('Validation Error', err); return; }
    setSaving(true);
    try {
      const email = form.email.trim().toLowerCase();
      const existing = email ? await getDriverByEmail(email) : null;
      await addDriver({
        fullName: form.fullName.trim(),
        age: parseInt(form.age),
        address: form.address.trim(),
        aadhaarCard: form.aadhaarCard.trim(),
        panCard: form.panCard.trim().toUpperCase(),
        vehicleOwned: form.vehicleOwned.trim().toUpperCase(),
        photoUrl: form.photoUrl,
        email,
        userId: '',
        licenseNumber: form.licenseNumber.trim(),
        licenseExpiry: form.licenseExpiry.trim(),
      });
      Alert.alert(
        'Success',
        existing
          ? 'A driver with this email already existed — their record was synced with the details you entered.'
          : 'Driver added successfully.'
      );
      setAddModal(false);
      setForm(emptyForm);
      load();
    } catch {
      Alert.alert('Error', 'Failed to add driver.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    const err = validate(editForm);
    if (err) { Alert.alert('Validation Error', err); return; }
    setSaving(true);
    try {
      await updateDriver(selected.id, {
        fullName: editForm.fullName.trim(),
        age: parseInt(editForm.age),
        address: editForm.address.trim(),
        aadhaarCard: editForm.aadhaarCard.trim(),
        panCard: editForm.panCard.trim().toUpperCase(),
        vehicleOwned: editForm.vehicleOwned.trim().toUpperCase(),
        photoUrl: editForm.photoUrl || selected.photoUrl,
        email: editForm.email.trim().toLowerCase(),
        licenseNumber: editForm.licenseNumber.trim(),
        licenseExpiry: editForm.licenseExpiry.trim(),
      });
      setIsEditing(false);
      setViewModal(false);
      setSelected(null);
      load();
    } catch {
      Alert.alert('Error', 'Failed to update driver.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLogin = () => {
    if (!selected) return;
    if (!selected.email) {
      Alert.alert('Email required', 'Add an email address to this driver before creating a login.');
      return;
    }
    Alert.alert('Create Login', `Create or link a login for ${selected.fullName} (${selected.email})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: async () => {
          setCreatingLogin(true);
          try {
            const result = await createDriverAccount(selected.id, selected.email!, selected.fullName);
            setCredentialsModal({ email: result.email, password: result.tempPassword, linkedExisting: result.linkedExisting });
            load();
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Failed to create login.');
          } finally {
            setCreatingLogin(false);
          }
        },
      },
    ]);
  };

  const handleDelete = () => {
    if (!selected) return;
    Alert.alert('Delete Driver', `Remove ${selected.fullName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDriver(selected.id);
            setViewModal(false);
            setSelected(null);
            load();
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Failed to delete driver.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.pageTitle}>Drivers</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => { setForm(emptyForm); setAddModal(true); }} activeOpacity={0.85}>
          <Text style={s.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search by name or vehicle..."
          placeholderTextColor={Colors.textMuted}
          value={searchQ}
          onChangeText={setSearchQ}
        />
      </View>

      {loading ? (
        <View style={{ padding: Spacing[3] }}>
          {[0,1,2,3,4].map(i => <ShimmerRow key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🚗</Text>
              <Text style={s.emptyText}>No drivers found</Text>
              <Text style={s.emptySub}>Tap "+ Add" to register a driver.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              onPress={() => { setSelected(item); setIsEditing(false); setViewModal(true); }}
              activeOpacity={0.85}
            >
              {item.photoUrl ? (
                <Image source={{ uri: item.photoUrl }} style={s.avatar} resizeMode="cover" />
              ) : (
                <View style={[s.avatar, s.avatarPlaceholder]}>
                  <Text style={s.avatarInitial}>{item.fullName[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={s.cardInfo}>
                <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
                  <Text style={s.cardName}>{item.fullName}</Text>
                  <View style={[s.statusPill, { backgroundColor: item.userId ? '#d1fae5' : '#fef3c7' }]}>
                    <Text style={[s.statusPillText, { color: item.userId ? '#065f46' : '#92400e' }]}>
                      {item.userId ? 'Linked' : 'Pending'}
                    </Text>
                  </View>
                </View>
                <Text style={s.cardMeta}>Age {item.age} · {item.vehicleOwned || 'No vehicle'}</Text>
                <Text style={s.cardAddr} numberOfLines={1}>{(item as any).email || item.address}</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Add Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { transform: [{ translateY: addSwipeY }] }]}>
            <View style={m.dragHeader} {...addModalPan.panHandlers}>
              <View style={m.handle} />
              <Text style={m.title}>Add Driver</Text>
            </View>
            <DriverForm
              f={form}
              setF={setField}
              onSave={handleAdd}
              onCancel={() => setAddModal(false)}
              submitLabel="Add Driver"
              saving={saving}
              onPickImage={pickImage}
            />
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* View/Edit Modal */}
      <Modal visible={viewModal} transparent animationType="slide" onRequestClose={() => { setViewModal(false); setIsEditing(false); }}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { transform: [{ translateY: viewSwipeY }] }]}>
            <View style={m.dragHeader} {...viewModalPan.panHandlers}>
              <View style={m.handle} />
              <Text style={m.title}>{isEditing ? 'Edit Driver' : 'Driver Details'}</Text>
            </View>

            {isEditing ? (
              <DriverForm
                f={editForm}
                setF={setEditField}
                onSave={handleSaveEdit}
                onCancel={() => setIsEditing(false)}
                submitLabel="Save Changes"
                saving={saving}
                onPickImage={pickImage}
              />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {selected?.photoUrl ? (
                  <Image source={{ uri: selected.photoUrl }} style={dv.photo} resizeMode="cover" />
                ) : (
                  <View style={[dv.photo, dv.photoPlaceholder]}>
                    <Text style={dv.photoInitial}>{selected?.fullName[0]?.toUpperCase()}</Text>
                  </View>
                )}
                {[
                  { label: 'Full Name', value: selected?.fullName },
                  { label: 'Age', value: selected?.age?.toString() },
                  { label: 'Vehicle', value: selected?.vehicleOwned },
                  { label: 'Address', value: selected?.address },
                  { label: 'Aadhaar', value: selected?.aadhaarCard },
                  { label: 'PAN Card', value: selected?.panCard },
                  { label: 'License No.', value: selected?.licenseNumber },
                  { label: 'License Expiry', value: selected?.licenseExpiry },
                  { label: 'Email', value: (selected as any)?.email || '—' },
                ].map(row => (
                  <View key={row.label} style={dv.row}>
                    <Text style={dv.label}>{row.label}</Text>
                    <Text style={dv.value}>{row.value || '—'}</Text>
                  </View>
                ))}
                <View style={dv.row}>
                  <Text style={dv.label}>Account</Text>
                  <View style={[dv.statusBadge, { backgroundColor: selected?.userId ? '#d1fae5' : '#fef3c7' }]}>
                    <Text style={[dv.statusText, { color: selected?.userId ? '#065f46' : '#92400e' }]}>
                      {selected?.userId ? '✓ Linked' : '⏳ Pending signup'}
                    </Text>
                  </View>
                </View>
                {!selected?.userId && (
                  <TouchableOpacity
                    style={[dv.editBtn, { backgroundColor: Colors.success, marginBottom: Spacing[3] }]}
                    onPress={handleCreateLogin}
                    disabled={creatingLogin}
                    activeOpacity={0.85}
                  >
                    {creatingLogin ? <ActivityIndicator color="#fff" size="small" /> : <Text style={dv.editBtnText}>Create Login</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[dv.editBtn, { backgroundColor: Colors.info, marginBottom: Spacing[3] }]}
                  onPress={() => {
                    setViewModal(false);
                    setSelected(null);
                    navigation.navigate('MainTabs', { driverFilter: selected!.fullName, openTrips: true });
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={dv.editBtnText}>View Trips</Text>
                </TouchableOpacity>
                <View style={dv.btns}>
                  <TouchableOpacity style={dv.editBtn} onPress={() => { setEditForm({ fullName: selected!.fullName, age: selected!.age.toString(), address: selected!.address, aadhaarCard: selected!.aadhaarCard, panCard: selected!.panCard, vehicleOwned: selected!.vehicleOwned ?? '', photoUrl: selected!.photoUrl, email: (selected as any).email ?? '', licenseNumber: selected!.licenseNumber ?? '', licenseExpiry: selected!.licenseExpiry ?? '' }); setIsEditing(true); }} activeOpacity={0.85}>
                    <Text style={dv.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={dv.deleteBtn} onPress={handleDelete} activeOpacity={0.85}>
                    <Text style={dv.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={dv.closeBtn} onPress={() => { setViewModal(false); setSelected(null); }} activeOpacity={0.85}>
                    <Text style={dv.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!credentialsModal} transparent animationType="fade" onRequestClose={() => setCredentialsModal(null)}>
        <View style={dv.credOverlay}>
          <View style={dv.credCard}>
            <Text style={dv.credTitle}>{credentialsModal?.linkedExisting ? 'Account Linked' : 'Login Created'}</Text>
            <Text style={dv.credBody}>
              {credentialsModal?.linkedExisting
                ? 'This email already had an account — the driver record and their existing trips have been synced to it. They can sign in with their existing password.'
                : 'Share these credentials with the driver securely. They should change the password after first login.'}
            </Text>

            <Text style={dv.credLabel}>Email</Text>
            <TextInput style={dv.credValue} value={credentialsModal?.email ?? ''} editable={false} selectTextOnFocus />

            {!!credentialsModal?.password && (
              <>
                <Text style={dv.credLabel}>Temporary Password</Text>
                <TextInput style={dv.credValue} value={credentialsModal.password} editable={false} selectTextOnFocus />
                <TouchableOpacity
                  style={dv.copyBtn}
                  activeOpacity={0.85}
                  onPress={async () => {
                    await Clipboard.setStringAsync(credentialsModal.password!);
                    Alert.alert('Copied', 'Password copied to clipboard.');
                  }}
                >
                  <Text style={dv.copyBtnText}>Copy Password</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={dv.closeBtn} activeOpacity={0.85} onPress={() => setCredentialsModal(null)}>
              <Text style={dv.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  backBtnText: { fontSize: 28, color: Colors.primary, fontWeight: '700' as const, lineHeight: 32 },
  pageTitle: { fontSize: FontSize['2xl'], fontWeight: '800' as const, color: Colors.text },
  addBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    ...Shadow.sm,
  },
  addBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.sm },
  searchRow: { paddingHorizontal: Spacing[5], paddingBottom: Spacing[3] } as const,
  search: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    borderWidth: 1.5,
    borderColor: Colors.border,
    letterSpacing: 0,
  },
  loaderCenter: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const } as const,
  listContent: { paddingHorizontal: Spacing[5], paddingBottom: Spacing[10] } as const,
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[3],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    ...Shadow.md,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, marginRight: Spacing[3] },
  avatarPlaceholder: {
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  avatarInitial: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.primary },
  cardInfo: { flex: 1 } as const,
  cardName: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text },
  cardMeta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  cardAddr: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 24, color: Colors.border, fontWeight: '700' as const },
  empty: { alignItems: 'center' as const, paddingVertical: Spacing[12] },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.textSecondary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  statusPillText: { fontSize: 10, fontWeight: '700' as const },
};

const m = {
  overlay: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing[5],
    maxHeight: '90%' as const,
  },
  dragHeader: {
    alignItems: 'center' as const,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[3],
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center' as const,
    marginBottom: Spacing[3],
  },
  title: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.text },
};

const fms = {
  photoBtn: { marginBottom: Spacing[4], borderRadius: Radius.lg, overflow: 'hidden' as const },
  photoImg: { width: '100%' as const, height: 160, borderRadius: Radius.lg },
  photoPlaceholder: {
    height: 100,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  photoPlaceholderIcon: { fontSize: 28 },
  photoPlaceholderText: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: Spacing[1] },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    letterSpacing: 0,
  },
  btns: { flexDirection: 'row' as const, gap: Spacing[3], marginTop: Spacing[4], marginBottom: Spacing[4] },
  cancelBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: FontSize.base },
  saveBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  saveText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};

const dv = {
  credOverlay: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: Spacing[5],
  },
  credCard: {
    width: '100%' as const,
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[5],
  },
  credTitle: { fontSize: FontSize.lg, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[2] },
  credBody: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing[4] },
  credLabel: { fontSize: FontSize.xs, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 4 },
  credValue: {
    fontSize: FontSize.base,
    fontWeight: '700' as const,
    color: Colors.text,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: Spacing[3],
  },
  copyBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center' as const,
    marginBottom: Spacing[3],
  },
  copyBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
  photo: { width: '100%' as const, height: 200, borderRadius: Radius.lg, marginBottom: Spacing[4] },
  photoPlaceholder: {
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  photoInitial: { fontSize: FontSize['4xl'], fontWeight: '800' as const, color: Colors.primary },
  row: {
    flexDirection: 'row' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, width: 90 },
  value: { fontSize: FontSize.base, color: Colors.text, flex: 1 },
  btns: { flexDirection: 'row' as const, gap: Spacing[3], marginTop: Spacing[5], marginBottom: Spacing[4] },
  editBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  editBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
  deleteBtn: {
    flex: 1,
    backgroundColor: Colors.danger,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  deleteBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
  closeBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  closeBtnText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: FontSize.base },
  statusBadge: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' as const },
};
