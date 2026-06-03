import React, { useState } from 'react';
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
import { signOut, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../firebaseConfig';
import { deleteUserAccountData } from '../services/userService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole } from './MainTabsScreen';

interface Props {
  role: UserRole;
}

export default function ProfileScreen({ role }: Props) {
  const navigation = useNavigation<any>();
  const user = auth.currentUser;
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePass, setDeletePass] = useState('');
  const [deleting, setDeleting] = useState(false);

  const roleLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Driver';
  const roleColor = role === 'admin' ? Colors.roleAdmin : role === 'manager' ? Colors.roleManager : Colors.roleDriver;
  const roleLight = role === 'admin' ? Colors.roleAdminLight : role === 'manager' ? Colors.roleManagerLight : Colors.roleDriverLight;

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => signOut(auth),
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (!deletePass.trim()) {
      Alert.alert('Required', 'Please enter your password.');
      return;
    }
    if (!user?.email) return;
    setDeleting(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, deletePass);
      await reauthenticateWithCredential(user, cred);
      await deleteUserAccountData(user.uid);
      await deleteUser(user);
      setDeleteModal(false);
    } catch (err: any) {
      const msg = err.code === 'auth/wrong-password' ? 'Incorrect password.' : 'Failed to delete account.';
      Alert.alert('Error', msg);
    } finally {
      setDeleting(false);
    }
  };

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initial}</Text>
          </View>
          <Text style={s.emailText}>{user?.email}</Text>
          <View style={[s.roleBadge, { backgroundColor: roleLight }]}>
            <Text style={[s.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
        </View>

        {/* Account Info */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Account</Text>
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Email</Text>
              <Text style={s.infoValue} numberOfLines={1}>{user?.email}</Text>
            </View>
            <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
              <Text style={s.infoLabel}>Role</Text>
              <Text style={[s.infoValue, { color: roleColor, fontWeight: '700' as const }]}>{roleLabel}</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Actions</Text>
          <TouchableOpacity style={s.actionBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={s.actionIcon}>🚪</Text>
            <Text style={s.actionLabel}>Sign Out</Text>
            <Text style={s.actionArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.actionBtn, s.dangerBtn]}
            onPress={() => {
              Alert.alert(
                'Delete Account',
                'This will permanently delete your account and all associated data. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Continue', style: 'destructive', onPress: () => setDeleteModal(true) },
                ]
              );
            }}
            activeOpacity={0.8}
          >
            <Text style={s.actionIcon}>🗑️</Text>
            <Text style={[s.actionLabel, { color: Colors.danger }]}>Delete Account</Text>
            <Text style={[s.actionArrow, { color: Colors.danger }]}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Delete Account Modal */}
      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => !deleting && setDeleteModal(false)}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={s.modalOverlay} onPress={() => !deleting && setDeleteModal(false)}>
            <View style={s.modalCard} onStartShouldSetResponder={() => true}>
              <Text style={s.modalTitle}>Confirm Deletion</Text>
              <Text style={s.modalSub}>Enter your password to permanently delete your account.</Text>
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
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => { setDeleteModal(false); setDeletePass(''); }}
                  disabled={deleting}
                >
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.confirmBtn} onPress={handleDeleteAccount} disabled={deleting}>
                  {deleting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.confirmBtnText}>Delete</Text>}
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
    marginBottom: Spacing[8],
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
  avatarText: { fontSize: FontSize['3xl'], fontWeight: '800' as const, color: '#fff' },
  emailText: { fontSize: FontSize.base, fontWeight: '600' as const, color: Colors.text, marginBottom: Spacing[2] },
  roleBadge: { paddingHorizontal: Spacing[4], paddingVertical: Spacing[1], borderRadius: Radius.full },
  roleText: { fontSize: FontSize.xs, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },

  section: { marginBottom: Spacing[6] } as const,
  sectionTitle: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.textMuted, marginBottom: Spacing[2], textTransform: 'uppercase' as const, letterSpacing: 0.5 },

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

  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[3],
    ...Shadow.sm,
  },
  dangerBtn: {
    borderWidth: 1,
    borderColor: Colors.dangerLight,
  },
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
  confirmBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};
