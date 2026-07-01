import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../supabaseConfig';
import { useNavigation } from '@react-navigation/native';
import { getUserByEmail, getUsers, isAdmin, isManager, updateUserRole } from '../services/userService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerRow } from '../components/Shimmer';

interface UserRecord {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  createdAt?: any;
}

const ROLE_CONFIG = {
  admin: { color: Colors.roleAdmin, bg: Colors.roleAdminLight, label: 'Admin' },
  manager: { color: Colors.roleManager, bg: Colors.roleManagerLight, label: 'Manager' },
  driver: { color: Colors.roleDriver, bg: Colors.roleDriverLight, label: 'Driver' },
};

export default function UserManagementScreen() {
  const navigation = useNavigation<any>();
  const currentUser = auth.currentUser;
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [pendingRole, setPendingRole] = useState<UserRecord['role']>('driver');
  const [addModal, setAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRecord['role']>('driver');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { init(); }, []);

  const init = async () => {
    if (!currentUser) { navigation.goBack(); return; }
    const [adminStatus, managerStatus] = await Promise.all([
      isAdmin(currentUser.uid),
      isManager(currentUser.uid),
    ]);
    if (!adminStatus && !managerStatus) {
      Alert.alert('Access Denied', 'Only admins and managers can access this screen.');
      navigation.goBack();
      return;
    }
    setIsUserAdmin(adminStatus);
    fetchUsers();
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const list = await getUsers();
      list.sort((a, b) => a.email.localeCompare(b.email));
      setUsers(list);
    } catch {
      Alert.alert('Error', 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  const openRoleModal = (u: UserRecord) => {
    setSelected(u);
    setPendingRole(u.role);
    setRoleModal(true);
  };

  const handleRoleChange = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateUserRole(selected.uid, pendingRole);
      setUsers(prev => prev.map(u => u.uid === selected.uid ? { ...u, role: pendingRole } : u));
      setRoleModal(false);
      setSelected(null);
    } catch {
      Alert.alert('Error', 'Failed to update role.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) { Alert.alert('Required', 'Please enter an email address.'); return; }
    if (!isUserAdmin) { Alert.alert('Access Denied', 'Only admins can assign roles.'); return; }
    setSaving(true);
    try {
      const userRecord = await getUserByEmail(email);
      if (!userRecord) {
        Alert.alert('Not Found', 'No account found for this email. The user must register first.');
        return;
      }
      await updateUserRole(userRecord.uid, newRole);
      setUsers(prev => prev.map(u => u.uid === userRecord.uid ? { ...u, role: newRole } : u));
      setAddModal(false);
      setNewEmail('');
      setNewRole('driver');
      Alert.alert('Success', `Role updated for ${email}`);
    } catch {
      Alert.alert('Error', 'Failed to update user role.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(searchQ.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQ.toLowerCase())
  );

  const counts = {
    admin: users.filter(u => u.role === 'admin').length,
    manager: users.filter(u => u.role === 'manager').length,
    driver: users.filter(u => u.role === 'driver').length,
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.pageTitle}>Users & Roles</Text>
        {isUserAdmin && (
          <TouchableOpacity style={s.addBtn} onPress={() => { setNewEmail(''); setNewRole('driver'); setAddModal(true); }} activeOpacity={0.85}>
            <Text style={s.addBtnText}>+ Assign</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      <View style={s.statsRow}>
        <View style={[s.statBox, { borderLeftColor: Colors.roleAdmin }]}>
          <Text style={[s.statNum, { color: Colors.roleAdmin }]}>{counts.admin}</Text>
          <Text style={s.statLbl}>Admins</Text>
        </View>
        <View style={[s.statBox, { borderLeftColor: Colors.roleManager }]}>
          <Text style={[s.statNum, { color: Colors.roleManager }]}>{counts.manager}</Text>
          <Text style={s.statLbl}>Managers</Text>
        </View>
        <View style={[s.statBox, { borderLeftColor: Colors.roleDriver }]}>
          <Text style={[s.statNum, { color: Colors.roleDriver }]}>{counts.driver}</Text>
          <Text style={s.statLbl}>Drivers</Text>
        </View>
        <View style={[s.statBox, { borderLeftColor: Colors.primary }]}>
          <Text style={[s.statNum, { color: Colors.primary }]}>{users.length}</Text>
          <Text style={s.statLbl}>Total</Text>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search by email or role..."
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
          keyExtractor={item => item.uid}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>👥</Text>
              <Text style={s.emptyText}>No users found</Text>
            </View>
          }
          renderItem={({ item }) => {
            const cfg = ROLE_CONFIG[item.role];
            return (
              <View style={s.card}>
                <View style={[s.avatarCircle, { backgroundColor: cfg.bg }]}>
                  <Text style={[s.avatarInitial, { color: cfg.color }]}>{item.email[0].toUpperCase()}</Text>
                </View>
                <View style={s.cardInfo}>
                  <Text style={s.cardEmail} numberOfLines={1}>{item.email}</Text>
                  <View style={[s.roleBadge, { backgroundColor: cfg.bg }]}>
                    <Text style={[s.roleText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>
                <TouchableOpacity style={s.editRoleBtn} onPress={() => openRoleModal(item)} activeOpacity={0.85}>
                  <Text style={s.editRoleBtnText}>Change Role</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* Role Change Modal */}
      <Modal visible={roleModal} transparent animationType="fade" onRequestClose={() => setRoleModal(false)}>
        <Pressable style={mo.overlay} onPress={() => !saving && setRoleModal(false)}>
          <View style={mo.card} onStartShouldSetResponder={() => true}>
            <Text style={mo.title}>Change Role</Text>
            <Text style={mo.sub}>{selected?.email}</Text>
            <View style={mo.roles}>
              {(['driver', 'manager', 'admin'] as const).map(r => {
                const cfg = ROLE_CONFIG[r];
                const active = pendingRole === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[mo.roleOption, active && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                    onPress={() => setPendingRole(r)}
                    activeOpacity={0.85}
                  >
                    <Text style={[mo.roleOptionText, active && { color: '#fff' }]}>{cfg.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={mo.btns}>
              <TouchableOpacity style={mo.cancelBtn} onPress={() => setRoleModal(false)} disabled={saving}>
                <Text style={mo.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={mo.confirmBtn} onPress={handleRoleChange} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={mo.confirmText}>Update</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Assign Role to existing user Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[mo.sheet, { transform: [{ translateY: addSwipeY }] }]}>
            <View style={mo.dragHeader} {...addModalPan.panHandlers}>
              <View style={mo.handle} />
              <Text style={mo.title}>Assign Role</Text>
            </View>
            <Text style={mo.sub}>The user must have already registered an account.</Text>

            <Text style={[mo.sub, { marginTop: Spacing[4], fontWeight: '600' as const, color: Colors.textSecondary }]}>Email address</Text>
            <TextInput
              style={mo.input}
              placeholder="user@example.com"
              placeholderTextColor={Colors.textMuted}
              value={newEmail}
              onChangeText={setNewEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={[mo.sub, { marginTop: Spacing[3], fontWeight: '600' as const, color: Colors.textSecondary }]}>Role to assign</Text>
            <View style={mo.roles}>
              {(['driver', 'manager', 'admin'] as const).map(r => {
                const cfg = ROLE_CONFIG[r];
                const active = newRole === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[mo.roleOption, active && { backgroundColor: cfg.color, borderColor: cfg.color }]}
                    onPress={() => setNewRole(r)}
                    activeOpacity={0.85}
                  >
                    <Text style={[mo.roleOptionText, active && { color: '#fff' }]}>{cfg.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={mo.btns}>
              <TouchableOpacity style={mo.cancelBtn} onPress={() => setAddModal(false)} disabled={saving}>
                <Text style={mo.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={mo.confirmBtn} onPress={handleAddUser} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={mo.confirmText}>Assign Role</Text>}
              </TouchableOpacity>
            </View>
          </Animated.View>
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
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    ...Shadow.sm,
  },
  addBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.xs },

  statsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: Spacing[5],
    paddingBottom: Spacing[3],
    gap: Spacing[2],
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing[3],
    borderLeftWidth: 3,
    ...Shadow.sm,
  },
  statNum: { fontSize: FontSize.xl, fontWeight: '800' as const },
  statLbl: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, fontWeight: '500' as const },

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
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: Spacing[3],
  },
  avatarInitial: { fontSize: FontSize.lg, fontWeight: '800' as const },
  cardInfo: { flex: 1 } as const,
  cardEmail: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.text, marginBottom: 4 },
  roleBadge: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 3,
    borderRadius: Radius.full,
    alignSelf: 'flex-start' as const,
  },
  roleText: { fontSize: FontSize.xs, fontWeight: '700' as const },
  editRoleBtn: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing[3],
    paddingVertical: 7,
    borderRadius: Radius.md,
  },
  editRoleBtnText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' as const },

  empty: { alignItems: 'center' as const, paddingVertical: Spacing[12] },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.textSecondary },
};

const mo = {
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[6],
    width: '88%' as const,
    maxWidth: 400,
    ...Shadow.lg,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing[6],
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
  title: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[1] },
  sub: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing[4] },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[4],
    paddingVertical: 14,
    fontSize: FontSize.base,
    color: Colors.text,
    marginBottom: Spacing[4],
    marginTop: Spacing[2],
  },
  roles: {
    flexDirection: 'row' as const,
    gap: Spacing[2],
    marginBottom: Spacing[5],
    marginTop: Spacing[2],
  },
  roleOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center' as const,
    backgroundColor: Colors.surfaceAlt,
  },
  roleOptionText: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.textSecondary },
  btns: { flexDirection: 'row' as const, gap: Spacing[3] },
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
  confirmBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  confirmText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};
