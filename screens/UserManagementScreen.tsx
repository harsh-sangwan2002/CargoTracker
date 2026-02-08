import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { useNavigation } from '@react-navigation/native';
import { isAdmin, isManager } from '../services/userService';
import { Picker } from '@react-native-picker/picker';

interface User {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  createdAt?: any;
}

export default function UserManagementScreen() {
  const navigation = useNavigation<any>();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  const [isUserManager, setIsUserManager] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [newRole, setNewRole] = useState<'driver' | 'manager' | 'admin'>('driver');
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'driver' | 'manager' | 'admin'>('driver');

  const currentUser = auth.currentUser;

  useEffect(() => {
    checkAdminAndFetchUsers();
  }, []);

  const checkAdminAndFetchUsers = async () => {
    if (!currentUser) {
      Alert.alert('Error', 'Not authenticated');
      navigation.goBack();
      return;
    }

    try {
      // Check if user is admin or manager
      const adminStatus = await isAdmin(currentUser.uid);
      const managerStatus = await isManager(currentUser.uid);
      
      if (!adminStatus && !managerStatus) {
        Alert.alert('Access Denied', 'Only admins and managers can access this page');
        navigation.goBack();
        return;
      }

      setIsUserAdmin(adminStatus);
      setIsUserManager(adminStatus || managerStatus); // Set true if either admin or manager
      await fetchUsers();
    } catch (error) {
      console.error('Error checking admin/manager status:', error);
      Alert.alert('Error', 'Failed to verify status');
      navigation.goBack();
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const usersCollection = collection(db, 'users');
      const snapshot = await getDocs(usersCollection);
      
      const usersList: User[] = [];
      snapshot.forEach((doc) => {
        usersList.push({
          uid: doc.id,
          ...doc.data(),
        } as User);
      });

      // Sort by email
      usersList.sort((a, b) => a.email.localeCompare(b.email));
      setUsers(usersList);
    } catch (error) {
      console.error('Error fetching users:', error);
      Alert.alert('Error', 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async () => {
    if (!selectedUser) return;

    try {
      const userRef = doc(db, 'users', selectedUser.uid);
      await updateDoc(userRef, { role: newRole });

      // Update local state
      setUsers(users.map(u => 
        u.uid === selectedUser.uid ? { ...u, role: newRole } : u
      ));

      Alert.alert('Success', `${selectedUser.email}'s role updated to ${newRole}`);
      setShowRoleModal(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error updating role:', error);
      Alert.alert('Error', 'Failed to update role');
    }
  };

  const openRoleModal = (user: User) => {
    setSelectedUser(user);
    setNewRole(user.role);
    setShowRoleModal(true);
  };

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }

    try {
      // Create new user with temporary password
      const tempPassword = Math.random().toString(36).slice(-8);
      
      // Call Firebase Auth API to create user
      // For this, you'll need a backend function or use a different approach
      // For now, showing a placeholder alert
      Alert.alert('User Creation', `Would create user: ${newUserEmail}\nRole: ${newUserRole}\n\nNote: Implement backend user creation in Firebase`);
      
      // Reset form
      setNewUserEmail('');
      setNewUserRole('driver');
      setShowAddUserModal(false);
    } catch (error) {
      console.error('Error adding user:', error);
      Alert.alert('Error', 'Failed to add user');
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return '#dc2626';
      case 'manager':
        return '#2563eb';
      case 'driver':
        return '#059669';
      default:
        return '#6b7280';
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isUserAdmin && !isUserManager) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>Access Denied</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>User Management</Text>
        <TouchableOpacity 
          onPress={() => setShowAddUserModal(true)}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>+ Add User</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{users.length}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>
            {users.filter(u => u.role === 'admin').length}
          </Text>
          <Text style={styles.statLabel}>Admins</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>
            {users.filter(u => u.role === 'manager').length}
          </Text>
          <Text style={styles.statLabel}>Managers</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>
            {users.filter(u => u.role === 'driver').length}
          </Text>
          <Text style={styles.statLabel}>Drivers</Text>
        </View>
      </View>

      <ScrollView style={styles.listContainer}>
        {users.length === 0 ? (
          <Text style={styles.emptyText}>No users found</Text>
        ) : (
          users.map((user) => (
            <View key={user.uid} style={styles.userCard}>
              <View style={styles.userInfo}>
                <Text style={styles.userEmail}>{user.email}</Text>
                <View style={[styles.roleTag, { backgroundColor: getRoleColor(user.role) + '20' }]}>
                  <Text style={[styles.roleTagText, { color: getRoleColor(user.role) }]}>
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => openRoleModal(user)}
              >
                <Text style={styles.editButtonText}>Edit Role</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      {/* Role Change Modal */}
      <Modal
        visible={showRoleModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowRoleModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowRoleModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Change Role for {selectedUser?.email}
            </Text>

            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Select New Role:</Text>
              <View style={styles.rolesContainer}>
                {['driver', 'manager', 'admin'].map((role) => (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.roleOption,
                      newRole === role && styles.roleOptionSelected,
                    ]}
                    onPress={() => setNewRole(role as 'driver' | 'manager' | 'admin')}
                  >
                    <Text
                      style={[
                        styles.roleOptionText,
                        newRole === role && styles.roleOptionTextSelected,
                      ]}
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowRoleModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleRoleChange}
              >
                <Text style={styles.confirmButtonText}>Update Role</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Add User Modal */}
      <Modal
        visible={showAddUserModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAddUserModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowAddUserModal(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add New User</Text>

            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Email Address:</Text>
              <TextInput
                style={styles.textInput}
                placeholder="user@example.com"
                placeholderTextColor="#9ca3af"
                value={newUserEmail}
                onChangeText={setNewUserEmail}
                keyboardType="email-address"
              />
            </View>

            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>User Role:</Text>
              <View style={styles.rolesContainer}>
                {['driver', 'manager', 'admin'].map((role) => (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.roleOption,
                      newUserRole === role && styles.roleOptionSelected,
                    ]}
                    onPress={() => setNewUserRole(role as 'driver' | 'manager' | 'admin')}
                  >
                    <Text
                      style={[
                        styles.roleOptionText,
                        newUserRole === role && styles.roleOptionTextSelected,
                      ]}
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalButtonContainer}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowAddUserModal(false);
                  setNewUserEmail('');
                  setNewUserRole('driver');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleAddUser}
              >
                <Text style={styles.confirmButtonText}>Add User</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = {
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  } as const,
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    fontSize: 16,
    color: '#2563eb',
    fontWeight: '600' as const,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#111827',
  },
  addButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 13,
  },
  statsContainer: {
    flexDirection: 'row' as const,
    paddingHorizontal: 12,
    paddingVertical: 16,
    backgroundColor: '#fff',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#2563eb',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center' as const,
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  userCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  userInfo: {
    flex: 1,
  },
  userEmail: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#111827',
    marginBottom: 8,
  },
  roleTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start' as const,
  },
  roleTagText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  editButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  editButtonText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 13,
  },
  emptyText: {
    textAlign: 'center' as const,
    color: '#9ca3af',
    fontSize: 16,
    padding: 40,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 14,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: '600' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '85%' as const,
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#111827',
    marginBottom: 20,
    textAlign: 'center' as const,
  },
  pickerContainer: {
    marginBottom: 20,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#374151',
    marginBottom: 12,
  },
  rolesContainer: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
    alignItems: 'center' as const,
  },
  roleOptionSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  roleOptionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#374151',
  },
  roleOptionTextSelected: {
    color: '#fff',
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    overflow: 'hidden' as const,
  },
  picker: {
    height: 50,
    width: '100%' as const,
    color: '#111827',
  },
  modalButtonContainer: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  cancelButton: {
    backgroundColor: '#e5e7eb',
  },
  confirmButton: {
    backgroundColor: '#2563eb',
  },
  cancelButtonText: {
    color: '#374151',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#f9fafb',
    marginBottom: 16,
  },
};
