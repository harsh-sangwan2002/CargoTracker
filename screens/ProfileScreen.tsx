import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth, reauthenticateWithPassword, signOut, updatePassword } from '../supabaseConfig';
import { deleteUserAccountData, getStaffProfile, upsertStaffProfile, seedManagerAccounts, StaffProfile } from '../services/userService';
import { getDriverByUserId, getDriverByEmail, addDriver, updateDriver, Driver } from '../services/driverService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole } from './MainTabsScreen';

interface Props {
  role: UserRole;
  profileComplete?: boolean;
  onProfileSaved?: () => void;
}

interface DriverForm {
  fullName: string;
  age: string;
  address: string;
  aadhaarCard: string;
  panCard: string;
}

const emptyDriverForm = (): DriverForm => ({ fullName: '', age: '', address: '', aadhaarCard: '', panCard: '' });

export default function ProfileScreen({ role, profileComplete = true, onProfileSaved }: Props) {
  const navigation = useNavigation<any>();
  const user = auth.currentUser;

  // Account deletion state
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePass, setDeletePass] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Driver profile state
  const [driverProfile, setDriverProfile] = useState<(Driver & { id: string }) | null>(null);
  const [driverForm, setDriverForm] = useState<DriverForm>(emptyDriverForm());
  const [editingProfile, setEditingProfile] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Staff (admin/manager) profile state
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [staffForm, setStaffForm] = useState<StaffProfile>({ fullName: '', phone: '', address: '' });
  const [editingStaff, setEditingStaff] = useState(false);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);

  // Change password state
  const [changePwModal, setChangePwModal] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  // Seed managers state
  const [seeding, setSeeding] = useState(false);

  const roleLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Driver';
  const roleColor = role === 'admin' ? Colors.roleAdmin : role === 'manager' ? Colors.roleManager : Colors.roleDriver;
  const roleLight = role === 'admin' ? Colors.roleAdminLight : role === 'manager' ? Colors.roleManagerLight : Colors.roleDriverLight;

  useEffect(() => {
    if (role === 'driver' || !user?.uid) return;
    setLoadingStaff(true);
    getStaffProfile(user.uid)
      .then(p => {
        if (p) { setStaffProfile(p); setStaffForm(p); }
      })
      .catch(() => {})
      .finally(() => setLoadingStaff(false));
  }, [role]);

  useEffect(() => {
    if (role !== 'driver' || !user?.uid) return;
    setLoadingProfile(true);
    const email = (user.email ?? '').trim().toLowerCase();

    getDriverByUserId(user.uid)
      .then(async byUid => {
        const profile = byUid ?? (email ? await getDriverByEmail(email) : null);
        if (profile) {
          setDriverProfile(profile);
          setDriverForm({
            fullName: profile.fullName,
            age: String(profile.age || ''),
            address: profile.address,
            aadhaarCard: profile.aadhaarCard,
            panCard: profile.panCard,
          });
          if (!profile.fullName?.trim()) setEditingProfile(true);
        } else {
          setEditingProfile(true);
        }
      })
      .catch(() => setEditingProfile(true))
      .finally(() => setLoadingProfile(false));
  }, [role]);

  const setFormField = (k: keyof DriverForm, v: string) => setDriverForm(prev => ({ ...prev, [k]: v }));

  const validateDriverForm = (): string | null => {
    if (!driverForm.fullName.trim()) return 'Full name is required.';
    if (!driverForm.age.trim() || !/^\d+$/.test(driverForm.age) || parseInt(driverForm.age) < 18 || parseInt(driverForm.age) > 80)
      return 'Age must be between 18 and 80.';
    if (!driverForm.address.trim()) return 'Address is required.';
    if (!/^\d{12}$/.test(driverForm.aadhaarCard.replace(/\s/g, ''))) return 'Aadhaar must be exactly 12 digits.';
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(driverForm.panCard.toUpperCase())) return 'Invalid PAN format (e.g. ABCDE1234F).';
    return null;
  };

  const handleSaveDriverProfile = async () => {
    const err = validateDriverForm();
    if (err) { Alert.alert('Validation Error', err); return; }
    if (!user?.uid) return;
    setSavingProfile(true);
    try {
      const uid = user.uid;
      const email = (user.email ?? '').trim().toLowerCase();
      const payload = {
        fullName: driverForm.fullName.trim(),
        age: parseInt(driverForm.age),
        address: driverForm.address.trim(),
        aadhaarCard: driverForm.aadhaarCard.trim(),
        panCard: driverForm.panCard.trim().toUpperCase(),
        email,
      };

      if (driverProfile) {
        await updateDriver(driverProfile.id, payload);
        setDriverProfile(prev => prev ? { ...prev, ...payload } : null);
      } else {
        const byEmail = email ? await getDriverByEmail(email) : null;
        if (byEmail) {
          await updateDriver(byEmail.id, { ...payload, userId: uid });
          setDriverProfile({ ...byEmail, ...payload, userId: uid });
        } else {
          const newId = await addDriver({
            ...payload,
            vehicleOwned: '',
            photoUrl: '',
            userId: uid,
          });
          setDriverProfile({
            id: newId as string,
            ...payload,
            vehicleOwned: '',
            photoUrl: '',
            userId: uid,
          });
        }
      }
      setEditingProfile(false);
      onProfileSaved?.();
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch {
      Alert.alert('Error', 'Failed to save profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveStaffProfile = async () => {
    if (!staffForm.fullName.trim()) { Alert.alert('Required', 'Full name is required.'); return; }
    if (!user?.uid) return;
    setSavingStaff(true);
    try {
      await upsertStaffProfile(user.uid, staffForm);
      setStaffProfile({ ...staffForm });
      setEditingStaff(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch {
      Alert.alert('Error', 'Failed to save profile. Make sure the database columns exist (see userService.ts comments).');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPass.trim()) { Alert.alert('Required', 'Enter your current password.'); return; }
    if (newPass.length < 6) { Alert.alert('Weak Password', 'New password must be at least 6 characters.'); return; }
    if (newPass !== confirmPass) { Alert.alert('Mismatch', 'New passwords do not match.'); return; }
    if (!user?.email) return;
    setChangingPw(true);
    try {
      await reauthenticateWithPassword(user.email, currentPass);
      await updatePassword(newPass);
      setChangePwModal(false);
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      Alert.alert('Done', 'Password changed successfully.');
    } catch (err: any) {
      const msg = (err.message ?? '').toLowerCase();
      Alert.alert('Error', msg.includes('invalid') ? 'Current password is incorrect.' : err.message || 'Failed to change password.');
    } finally {
      setChangingPw(false);
    }
  };

  const handleSeedManagers = async () => {
    Alert.alert(
      'Seed Manager Accounts',
      'This will create:\n• manager1@cargotracker.com\n• manager2@cargotracker.com\n\nPassword: Manager@123\n\nNote: Requires email confirmation to be OFF in Supabase Auth settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create', onPress: async () => {
            setSeeding(true);
            try {
              const results = await seedManagerAccounts();
              const summary = results.map(r => `${r.email}: ${r.status}`).join('\n');
              Alert.alert('Seeding Complete', summary);
            } catch {
              Alert.alert('Error', 'Failed to seed accounts.');
            } finally {
              setSeeding(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (!deletePass.trim()) { Alert.alert('Required', 'Please enter your password.'); return; }
    if (!user?.email) return;
    setDeleting(true);
    try {
      await reauthenticateWithPassword(user.email, deletePass);
      await deleteUserAccountData(user.uid);
      await signOut();
      setDeleteModal(false);
    } catch (err: any) {
      Alert.alert('Error', err.message?.toLowerCase?.().includes('invalid') ? 'Incorrect password.' : 'Failed to delete account.');
    } finally {
      setDeleting(false);
    }
  };

  const initial = (driverProfile?.fullName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={[s.avatar, !profileComplete && role === 'driver' && s.avatarIncomplete]}>
            <Text style={s.avatarText}>{initial}</Text>
            {!profileComplete && role === 'driver' && <View style={s.avatarBadge} />}
          </View>
          <Text style={s.emailText}>{user?.email}</Text>
          <View style={[s.roleBadge, { backgroundColor: roleLight }]}>
            <Text style={[s.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
          {!profileComplete && role === 'driver' && (
            <View style={s.incompleteBanner}>
              <Text style={s.incompleteBannerText}>⚠ Complete your profile to get started</Text>
            </View>
          )}
        </View>

        {/* Driver Profile Section */}
        {role === 'driver' && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Driver Profile</Text>
              {driverProfile && !editingProfile && (
                <TouchableOpacity onPress={() => setEditingProfile(true)} activeOpacity={0.7}>
                  <Text style={s.editLink}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {loadingProfile ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing[4] }} />
            ) : editingProfile ? (
              /* Edit / Complete form */
              <View style={s.profileCard}>
                {[
                  { key: 'fullName' as const, label: 'Full Name *', autoCapitalize: 'words' as const, placeholder: 'Your full name' },
                  { key: 'age' as const, label: 'Age * (18–80)', keyboardType: 'numeric' as const, placeholder: '25' },
                  { key: 'aadhaarCard' as const, label: 'Aadhaar * (12 digits)', keyboardType: 'numeric' as const, maxLength: 12, placeholder: '123456789012' },
                  { key: 'panCard' as const, label: 'PAN Card *', autoCapitalize: 'characters' as const, maxLength: 10, placeholder: 'ABCDE1234F' },
                ].map(field => (
                  <View key={field.key} style={s.formRow}>
                    <Text style={s.formLabel}>{field.label}</Text>
                    <TextInput
                      style={s.formInput}
                      value={driverForm[field.key]}
                      onChangeText={v => setFormField(field.key, v)}
                      autoCapitalize={field.autoCapitalize ?? 'sentences'}
                      keyboardType={(field as any).keyboardType ?? 'default'}
                      maxLength={(field as any).maxLength}
                      placeholder={field.placeholder}
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                ))}
                <View style={s.formRow}>
                  <Text style={s.formLabel}>Address *</Text>
                  <TextInput
                    style={[s.formInput, { height: 80, textAlignVertical: 'top' }]}
                    value={driverForm.address}
                    onChangeText={v => setFormField('address', v)}
                    multiline
                    numberOfLines={3}
                    placeholder="Full address"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="sentences"
                  />
                </View>
                <View style={s.formRow}>
                  <Text style={s.formLabel}>Email</Text>
                  <TextInput style={[s.formInput, s.formInputReadonly]} value={user?.email ?? ''} editable={false} />
                </View>
                <View style={s.formBtns}>
                  {driverProfile && (
                    <TouchableOpacity style={s.cancelFormBtn} onPress={() => setEditingProfile(false)} disabled={savingProfile}>
                      <Text style={s.cancelFormBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.saveFormBtn, !driverProfile && { flex: 1 }]}
                    onPress={handleSaveDriverProfile}
                    disabled={savingProfile}
                    activeOpacity={0.85}
                  >
                    {savingProfile
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.saveFormBtnText}>{driverProfile ? 'Save Changes' : 'Complete Profile'}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              /* Read-only view */
              <View style={s.infoCard}>
                {[
                  { label: 'Full Name', value: driverProfile?.fullName },
                  { label: 'Age', value: driverProfile?.age?.toString() },
                  { label: 'Aadhaar', value: driverProfile?.aadhaarCard },
                  { label: 'PAN Card', value: driverProfile?.panCard },
                  { label: 'Email', value: user?.email ?? '' },
                ].map((row, i, arr) => (
                  <View key={row.label} style={[s.infoRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={s.infoLabel}>{row.label}</Text>
                    <Text style={s.infoValue}>{row.value || '—'}</Text>
                  </View>
                ))}
                {!!driverProfile?.address && (
                  <View style={[s.infoRow, { borderBottomWidth: 0, flexDirection: 'column' as const, alignItems: 'flex-start' as const }]}>
                    <Text style={[s.infoLabel, { marginBottom: Spacing[1] }]}>Address</Text>
                    <Text style={[s.infoValue, { maxWidth: '100%' as const }]}>{driverProfile.address}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Admin / Manager Profile Section */}
        {role !== 'driver' && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Profile Details</Text>
              {staffProfile && !editingStaff && (
                <TouchableOpacity onPress={() => setEditingStaff(true)} activeOpacity={0.7}>
                  <Text style={s.editLink}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>

            {loadingStaff ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing[4] }} />
            ) : editingStaff || !staffProfile ? (
              <View style={s.profileCard}>
                {([
                  { key: 'fullName' as const, label: 'Full Name *', placeholder: 'Your full name', autoCapitalize: 'words' as const },
                  { key: 'phone' as const, label: 'Phone', placeholder: '+91 98765 43210', keyboardType: 'phone-pad' as const },
                ] as const).map(field => (
                  <View key={field.key} style={s.formRow}>
                    <Text style={s.formLabel}>{field.label}</Text>
                    <TextInput
                      style={s.formInput}
                      value={staffForm[field.key]}
                      onChangeText={v => setStaffForm(p => ({ ...p, [field.key]: v }))}
                      placeholder={field.placeholder}
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize={(field as any).autoCapitalize ?? 'none'}
                      keyboardType={(field as any).keyboardType ?? 'default'}
                    />
                  </View>
                ))}
                <View style={s.formRow}>
                  <Text style={s.formLabel}>Address</Text>
                  <TextInput
                    style={[s.formInput, { height: 80, textAlignVertical: 'top' }]}
                    value={staffForm.address}
                    onChangeText={v => setStaffForm(p => ({ ...p, address: v }))}
                    multiline numberOfLines={3}
                    placeholder="Office / home address"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="sentences"
                  />
                </View>
                <View style={s.formRow}>
                  <Text style={s.formLabel}>Email</Text>
                  <TextInput style={[s.formInput, s.formInputReadonly]} value={user?.email ?? ''} editable={false} />
                </View>
                <View style={s.formBtns}>
                  {staffProfile && (
                    <TouchableOpacity style={s.cancelFormBtn} onPress={() => setEditingStaff(false)} disabled={savingStaff}>
                      <Text style={s.cancelFormBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.saveFormBtn, !staffProfile && { flex: 1 }]}
                    onPress={handleSaveStaffProfile}
                    disabled={savingStaff}
                    activeOpacity={0.85}
                  >
                    {savingStaff
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.saveFormBtnText}>{staffProfile ? 'Save Changes' : 'Save Profile'}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={s.infoCard}>
                {[
                  { label: 'Full Name', value: staffProfile.fullName },
                  { label: 'Phone', value: staffProfile.phone },
                  { label: 'Email', value: user?.email ?? '' },
                  { label: 'Role', value: roleLabel },
                ].map((row, i, arr) => (
                  <View key={row.label} style={[s.infoRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                    <Text style={s.infoLabel}>{row.label}</Text>
                    <Text style={[s.infoValue, row.label === 'Role' && { color: roleColor, fontWeight: '700' as const }]}>{row.value || '—'}</Text>
                  </View>
                ))}
                {!!staffProfile.address && (
                  <View style={[s.infoRow, { borderBottomWidth: 0, flexDirection: 'column' as const, alignItems: 'flex-start' as const }]}>
                    <Text style={[s.infoLabel, { marginBottom: Spacing[1] }]}>Address</Text>
                    <Text style={[s.infoValue, { maxWidth: '100%' as const }]}>{staffProfile.address}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Add details prompt when no profile yet */}
            {!staffProfile && !editingStaff && !loadingStaff && (
              <TouchableOpacity style={s.addDetailsBtn} onPress={() => setEditingStaff(true)} activeOpacity={0.85}>
                <Text style={s.addDetailsBtnText}>+ Add Profile Details</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Actions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Actions</Text>
          <TouchableOpacity style={s.actionBtn} onPress={() => setChangePwModal(true)} activeOpacity={0.8}>
            <Text style={s.actionIcon}>🔑</Text>
            <Text style={s.actionLabel}>Change Password</Text>
            <Text style={s.actionArrow}>›</Text>
          </TouchableOpacity>
          {role === 'admin' && (
            <TouchableOpacity style={s.actionBtn} onPress={handleSeedManagers} activeOpacity={0.8} disabled={seeding}>
              <Text style={s.actionIcon}>👥</Text>
              <Text style={s.actionLabel}>{seeding ? 'Creating Managers...' : 'Seed Test Managers'}</Text>
              {seeding ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={s.actionArrow}>›</Text>}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.actionBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={s.actionIcon}>🚪</Text>
            <Text style={s.actionLabel}>Sign Out</Text>
            <Text style={s.actionArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.dangerBtn]}
            onPress={() => {
              Alert.alert(
                'Delete App Data',
                'This will permanently delete your Cargo Tracker profile data and sign you out. Supabase Auth account deletion requires an admin backend.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Continue', style: 'destructive', onPress: () => setDeleteModal(true) },
                ]
              );
            }}
            activeOpacity={0.8}
          >
            <Text style={s.actionIcon}>🗑️</Text>
            <Text style={[s.actionLabel, { color: Colors.danger }]}>Delete App Data</Text>
            <Text style={[s.actionArrow, { color: Colors.danger }]}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Change Password Modal */}
      <Modal visible={changePwModal} transparent animationType="fade" onRequestClose={() => !changingPw && setChangePwModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={s.modalOverlay} onPress={() => !changingPw && setChangePwModal(false)}>
            <View style={s.modalCard} onStartShouldSetResponder={() => true}>
              <Text style={s.modalTitle}>Change Password</Text>
              <Text style={s.modalSub}>Enter your current password, then choose a new one.</Text>
              {[
                { placeholder: 'Current password', value: currentPass, onChange: setCurrentPass },
                { placeholder: 'New password (min 6 chars)', value: newPass, onChange: setNewPass },
                { placeholder: 'Confirm new password', value: confirmPass, onChange: setConfirmPass },
              ].map((f, i) => (
                <TextInput
                  key={i}
                  style={[s.modalInput, i < 2 && { marginBottom: Spacing[3] }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={Colors.textMuted}
                  value={f.value}
                  onChangeText={f.onChange}
                  secureTextEntry
                  editable={!changingPw}
                />
              ))}
              <View style={[s.modalBtns, { marginTop: Spacing[4] }]}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setChangePwModal(false); setCurrentPass(''); setNewPass(''); setConfirmPass(''); }} disabled={changingPw}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.updateBtn} onPress={handleChangePassword} disabled={changingPw}>
                  {changingPw ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>Update</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete App Data Modal */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={s.modalOverlay} onPress={() => !deleting && setDeleteModal(false)}>
            <View style={s.modalCard} onStartShouldSetResponder={() => true}>
              <Text style={s.modalTitle}>Confirm Deletion</Text>
              <Text style={s.modalSub}>Enter your password to delete your app profile data.</Text>
              <TextInput
                style={s.modalInput}
                placeholder="Password"
                placeholderTextColor={Colors.textMuted}
                value={deletePass}
                onChangeText={setDeletePass}
                secureTextEntry
                editable={!deleting}
              />
              <View style={s.modalBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setDeleteModal(false); setDeletePass(''); }} disabled={deleting}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.confirmBtn} onPress={handleDeleteAccount} disabled={deleting}>
                  {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>Delete</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { padding: Spacing[5], paddingBottom: Spacing[10] } as const,

  avatarSection: {
    alignItems: 'center' as const,
    marginBottom: Spacing[6],
    paddingTop: Spacing[4],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[3],
    ...Shadow.lg,
  },
  avatarIncomplete: {
    borderWidth: 2.5,
    borderColor: Colors.danger,
  },
  avatarBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.danger,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  avatarText: { fontSize: FontSize['3xl'], fontWeight: '800' as const, color: '#fff' },
  emailText: { fontSize: FontSize.base, fontWeight: '600' as const, color: Colors.text, marginBottom: Spacing[2] },
  roleBadge: { paddingHorizontal: Spacing[4], paddingVertical: Spacing[1], borderRadius: Radius.full },
  roleText: { fontSize: FontSize.xs, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },

  incompleteBanner: {
    marginTop: Spacing[3],
    backgroundColor: Colors.dangerLight,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
  },
  incompleteBannerText: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: '600' as const,
  },

  section: { marginBottom: Spacing[6] } as const,
  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[2],
  },
  sectionTitle: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  editLink: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.primary },

  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    ...Shadow.sm,
    overflow: 'hidden' as const,
  },
  infoRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' as const },
  infoValue: { fontSize: FontSize.sm, color: Colors.text, maxWidth: '60%' as const },

  profileCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    ...Shadow.sm,
  },
  formRow: { marginBottom: Spacing[3] } as const,
  formLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' as const, marginBottom: Spacing[1] },
  formInput: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    letterSpacing: 0,
  },
  formInputReadonly: {
    opacity: 0.6,
  },
  formBtns: {
    flexDirection: 'row' as const,
    gap: Spacing[3],
    marginTop: Spacing[2],
  },
  cancelFormBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelFormBtnText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: FontSize.base },
  saveFormBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  saveFormBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },

  addDetailsBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed' as const,
    marginTop: Spacing[2],
  },
  addDetailsBtnText: { color: Colors.primary, fontWeight: '700' as const, fontSize: FontSize.base },

  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[3],
    ...Shadow.sm,
  },
  dangerBtn: { borderWidth: 1, borderColor: Colors.dangerLight },
  actionIcon: { fontSize: 22, marginRight: Spacing[3] },
  actionLabel: { flex: 1, fontSize: FontSize.base, fontWeight: '600' as const, color: Colors.text },
  actionArrow: { fontSize: 22, color: Colors.textMuted },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[6],
    width: '88%' as const,
    maxWidth: 420,
    ...Shadow.lg,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: '700' as const, color: Colors.text, marginBottom: Spacing[1] },
  modalSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing[4], lineHeight: 20 },
  modalInput: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: 14,
    fontSize: FontSize.base,
    color: Colors.text,
    letterSpacing: 0,
    marginBottom: Spacing[4],
  },
  modalBtns: { flexDirection: 'row' as const, gap: Spacing[3] },
  cancelBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: FontSize.base },
  confirmBtn: {
    flex: 1,
    backgroundColor: Colors.danger,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  updateBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
  },
  confirmBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};
