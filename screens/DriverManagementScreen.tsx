import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../firebaseConfig';
import { getDrivers, addDriver, updateDriver, deleteDriver, Driver } from '../services/driverService';
import { convertImageToBase64 } from '../services/userService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';

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

  const emptyForm = { fullName: '', age: '', address: '', aadhaarCard: '', panCard: '', vehicleOwned: '', photoUrl: '' };
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);

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
    return null;
  };

  const handleAdd = async () => {
    const err = validate(form);
    if (err) { Alert.alert('Validation Error', err); return; }
    setSaving(true);
    try {
      await addDriver({
        fullName: form.fullName.trim(),
        age: parseInt(form.age),
        address: form.address.trim(),
        aadhaarCard: form.aadhaarCard.trim(),
        panCard: form.panCard.trim().toUpperCase(),
        vehicleOwned: form.vehicleOwned.trim().toUpperCase(),
        photoUrl: form.photoUrl,
        userId: user?.uid ?? '',
      });
      Alert.alert('Success', 'Driver added successfully.');
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
          } catch {
            Alert.alert('Error', 'Failed to delete driver.');
          }
        },
      },
    ]);
  };

  const DriverForm = ({ f, setF, onSave, onCancel, submitLabel }: {
    f: typeof emptyForm;
    setF: (k: string, v: string) => void;
    onSave: () => void;
    onCancel: () => void;
    submitLabel: string;
  }) => (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Photo */}
      <TouchableOpacity style={fms.photoBtn} onPress={() => pickImage(submitLabel === 'Save Changes')} activeOpacity={0.8}>
        {f.photoUrl ? (
          <Image source={{ uri: f.photoUrl }} style={fms.photoImg} />
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
        { key: 'vehicleOwned', label: 'Vehicle *', autoCapitalize: 'characters' as const, placeholder: 'HR26AB1234' },
        { key: 'aadhaarCard', label: 'Aadhaar * (12 digits)', keyboardType: 'numeric' as const, maxLength: 12, placeholder: '123456789012' },
        { key: 'panCard', label: 'PAN Card *', autoCapitalize: 'characters' as const, maxLength: 10, placeholder: 'ABCDE1234F' },
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
        <View style={s.loaderCenter}><ActivityIndicator size="large" color={Colors.primary} /></View>
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
              {item.photoUrl?.startsWith('data:') ? (
                <Image source={{ uri: item.photoUrl }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarPlaceholder]}>
                  <Text style={s.avatarInitial}>{item.fullName[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={s.cardInfo}>
                <Text style={s.cardName}>{item.fullName}</Text>
                <Text style={s.cardMeta}>Age {item.age} · {item.vehicleOwned || 'No vehicle'}</Text>
                <Text style={s.cardAddr} numberOfLines={1}>{item.address}</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Add Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>Add Driver</Text>
            <DriverForm
              f={form}
              setF={setField}
              onSave={handleAdd}
              onCancel={() => setAddModal(false)}
              submitLabel="Add Driver"
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* View/Edit Modal */}
      <Modal visible={viewModal} transparent animationType="slide" onRequestClose={() => { setViewModal(false); setIsEditing(false); }}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>{isEditing ? 'Edit Driver' : 'Driver Details'}</Text>

            {isEditing ? (
              <DriverForm
                f={editForm}
                setF={setEditField}
                onSave={handleSaveEdit}
                onCancel={() => setIsEditing(false)}
                submitLabel="Save Changes"
              />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {selected?.photoUrl?.startsWith('data:') ? (
                  <Image source={{ uri: selected.photoUrl }} style={dv.photo} />
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
                ].map(row => (
                  <View key={row.label} style={dv.row}>
                    <Text style={dv.label}>{row.label}</Text>
                    <Text style={dv.value}>{row.value || '—'}</Text>
                  </View>
                ))}
                <View style={dv.btns}>
                  <TouchableOpacity style={dv.editBtn} onPress={() => { setEditForm({ fullName: selected!.fullName, age: selected!.age.toString(), address: selected!.address, aadhaarCard: selected!.aadhaarCard, panCard: selected!.panCard, vehicleOwned: selected!.vehicleOwned ?? '', photoUrl: selected!.photoUrl }); setIsEditing(true); }} activeOpacity={0.85}>
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
          </View>
        </KeyboardAvoidingView>
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
    backgroundColor: Colors.success,
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
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center' as const,
    marginBottom: Spacing[4],
  },
  title: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[4] },
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
    backgroundColor: Colors.success,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  saveText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};

const dv = {
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
};
