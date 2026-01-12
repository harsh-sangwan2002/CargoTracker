import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../firebaseConfig';
import { getDrivers, addDriver, updateDriver, deleteDriver, Driver } from '../services/driverService';

export default function DriverManagementScreen() {
  const navigation = useNavigation<any>();
  const user = auth.currentUser;

  // Lists and modal states
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<(Driver & { id: string }) | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Add form states
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [aadhaarCard, setAadhaarCard] = useState('');
  const [panCard, setPanCard] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');

  // Edit form states
  const [editFullName, setEditFullName] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editAadhaarCard, setEditAadhaarCard] = useState('');
  const [editPanCard, setEditPanCard] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState('');
  const [editPhotoBase64, setEditPhotoBase64] = useState('');

  useEffect(() => {
    loadDrivers();
  }, []);

  const loadDrivers = async () => {
    try {
      setLoading(true);
      const fetchedDrivers = await getDrivers(user?.uid);
      setDrivers(fetchedDrivers);
    } catch (error) {
      console.error('Error loading drivers:', error);
      Alert.alert('Error', 'Failed to load drivers');
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async (isEditing: boolean = false) => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.8,
      }, (response) => {
        if (response.didCancel) {
          console.log('User cancelled image picker');
        } else if (response.errorCode) {
          Alert.alert('Error', 'Failed to pick image');
        } else if (response.assets && response.assets.length > 0) {
          const asset = response.assets[0];
          const base64 = asset.base64 || '';
          const dataUrl = `data:image/jpeg;base64,${base64}`;

          if (isEditing) {
            setEditPhotoUrl(asset.uri || '');
            setEditPhotoBase64(dataUrl);
          } else {
            setPhotoUrl(asset.uri || '');
            setPhotoBase64(dataUrl);
          }
        }
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to launch image picker');
    }
  };

  const resetAddForm = () => {
    setFullName('');
    setAge('');
    setAddress('');
    setAadhaarCard('');
    setPanCard('');
    setPhotoUrl('');
    setPhotoBase64('');
  };

  const handleAddDriver = async () => {
    if (!fullName.trim() || !age.trim() || !address.trim() || !aadhaarCard.trim() || !panCard.trim()) {
      Alert.alert('Required Fields', 'Please fill all required fields');
      return;
    }

    if (!/^\d+$/.test(age) || parseInt(age) < 18 || parseInt(age) > 80) {
      Alert.alert('Invalid Age', 'Age must be between 18 and 80');
      return;
    }

    if (!/^[0-9]{12}$/.test(aadhaarCard.replace(/\s/g, ''))) {
      Alert.alert('Invalid Aadhaar', 'Aadhaar must be 12 digits');
      return;
    }

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}/.test(panCard)) {
      Alert.alert('Invalid PAN', 'Invalid PAN format');
      return;
    }

    try {
      const driverData: Omit<Driver, 'createdAt' | 'updatedAt'> = {
        fullName: fullName.trim(),
        age: parseInt(age),
        address: address.trim(),
        aadhaarCard: aadhaarCard.trim(),
        panCard: panCard.trim().toUpperCase(),
        photoUrl: photoBase64 || '',
        userId: user?.uid || '',
      };

      await addDriver(driverData);
      Alert.alert('Success', 'Driver added successfully');
      resetAddForm();
      await loadDrivers();
      setAddModalVisible(false);
    } catch (error) {
      console.error('Error adding driver:', error);
      Alert.alert('Error', 'Failed to add driver');
    }
  };

  const handleDriverPress = (driver: Driver & { id: string }) => {
    setSelectedDriver(driver);
    setViewModalVisible(true);
    setIsEditing(false);
  };

  const handleEditPress = () => {
    if (selectedDriver) {
      setEditFullName(selectedDriver.fullName);
      setEditAge(selectedDriver.age.toString());
      setEditAddress(selectedDriver.address);
      setEditAadhaarCard(selectedDriver.aadhaarCard);
      setEditPanCard(selectedDriver.panCard);
      setEditPhotoUrl(selectedDriver.photoUrl);
      setIsEditing(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedDriver) return;

    if (!editFullName.trim() || !editAge.trim() || !editAddress.trim() || !editAadhaarCard.trim() || !editPanCard.trim()) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    try {
      const updatedData: Partial<Driver> = {
        fullName: editFullName.trim(),
        age: parseInt(editAge),
        address: editAddress.trim(),
        aadhaarCard: editAadhaarCard.trim(),
        panCard: editPanCard.trim().toUpperCase(),
        photoUrl: editPhotoBase64 || selectedDriver.photoUrl,
      };

      await updateDriver(selectedDriver.id, updatedData);
      Alert.alert('Success', 'Driver updated successfully');
      setIsEditing(false);
      setViewModalVisible(false);
      setSelectedDriver(null);
      await loadDrivers();
    } catch (error) {
      console.error('Error updating driver:', error);
      Alert.alert('Error', 'Failed to update driver');
    }
  };

  const handleDeleteDriver = () => {
    if (!selectedDriver) return;

    Alert.alert('Delete Driver', 'Are you sure you want to delete this driver?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDriver(selectedDriver.id);
            Alert.alert('Success', 'Driver deleted');
            setViewModalVisible(false);
            setSelectedDriver(null);
            await loadDrivers();
          } catch (error) {
            console.error('Error deleting driver:', error);
            Alert.alert('Error', 'Failed to delete driver');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Drivers</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* Drivers List */}
        <View style={styles.driversList}>
          {loading ? (
            <ActivityIndicator size="large" color="#1d4ed8" style={{ marginTop: 20 }} />
          ) : drivers.length === 0 ? (
            <Text style={styles.emptyText}>No drivers added yet</Text>
          ) : (
            drivers.map((driver) => (
              <TouchableOpacity
                key={driver.id}
                style={styles.driverCard}
                onPress={() => handleDriverPress(driver)}
              >
                {driver.photoUrl && driver.photoUrl.startsWith('data:') ? (
                  <Image
                    source={{ uri: driver.photoUrl }}
                    style={styles.driverPhoto}
                  />
                ) : (
                  <View style={[styles.driverPhoto, styles.noPhoto]}>
                    <Text style={styles.noPhotoText}>No Photo</Text>
                  </View>
                )}

                <View style={styles.driverInfo}>
                  <Text style={styles.driverName}>{driver.fullName}</Text>
                  <Text style={styles.driverAge}>Age: {driver.age}</Text>
                  <Text style={styles.driverAddress}>{driver.address}</Text>
                  <Text style={styles.driverId}>Aadhaar: {driver.aadhaarCard}</Text>
                </View>

                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity style={styles.fab} onPress={() => setAddModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* ======================== ADD DRIVER MODAL ======================== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={addModalVisible}
        onRequestClose={() => {
          resetAddForm();
          setAddModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Add New Driver</Text>

              {/* Photo Section */}
              <TouchableOpacity
                style={styles.photoSection}
                onPress={() => pickImage(false)}
              >
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.photoPreview} />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Text style={styles.photoPlaceholderText}>📷 Add Photo</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Full Name */}
              <TextInput
                style={styles.modalInput}
                placeholder="Full Name *"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />

              {/* Age */}
              <TextInput
                style={styles.modalInput}
                placeholder="Age (18-80) *"
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
              />

              {/* Address */}
              <TextInput
                style={[styles.modalInput, styles.textAreaInput]}
                placeholder="Address *"
                value={address}
                onChangeText={setAddress}
                multiline
                numberOfLines={3}
                autoCapitalize="sentences"
              />

              {/* Aadhaar Card */}
              <TextInput
                style={styles.modalInput}
                placeholder="Aadhaar Card (12 digits) *"
                value={aadhaarCard}
                onChangeText={setAadhaarCard}
                keyboardType="numeric"
                maxLength={12}
              />

              {/* PAN Card */}
              <TextInput
                style={styles.modalInput}
                placeholder="PAN Card *"
                value={panCard}
                onChangeText={setPanCard}
                autoCapitalize="characters"
                maxLength={10}
              />

              {/* Buttons */}
              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    resetAddForm();
                    setAddModalVisible(false);
                  }}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.saveButton]}
                  onPress={handleAddDriver}
                >
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ======================== VIEW / EDIT MODAL ======================== */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={viewModalVisible}
        onRequestClose={() => {
          setViewModalVisible(false);
          setIsEditing(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{isEditing ? 'Edit Driver' : 'Driver Details'}</Text>

              {isEditing ? (
                <>
                  {/* Photo Section */}
                  <TouchableOpacity
                    style={styles.photoSection}
                    onPress={() => pickImage(true)}
                  >
                    {editPhotoBase64 || (selectedDriver?.photoUrl && selectedDriver.photoUrl.startsWith('data:')) ? (
                      <Image
                        source={{ uri: editPhotoBase64 || selectedDriver?.photoUrl }}
                        style={styles.photoPreview}
                      />
                    ) : (
                      <View style={styles.photoPlaceholder}>
                        <Text style={styles.photoPlaceholderText}>📷 Change Photo</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  {/* Full Name */}
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Full Name *"
                    value={editFullName}
                    onChangeText={setEditFullName}
                    autoCapitalize="words"
                  />

                  {/* Age */}
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Age (18-80) *"
                    value={editAge}
                    onChangeText={setEditAge}
                    keyboardType="numeric"
                  />

                  {/* Address */}
                  <TextInput
                    style={[styles.modalInput, styles.textAreaInput]}
                    placeholder="Address *"
                    value={editAddress}
                    onChangeText={setEditAddress}
                    multiline
                    numberOfLines={3}
                    autoCapitalize="sentences"
                  />

                  {/* Aadhaar Card */}
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Aadhaar Card (12 digits) *"
                    value={editAadhaarCard}
                    onChangeText={setEditAadhaarCard}
                    keyboardType="numeric"
                    maxLength={12}
                  />

                  {/* PAN Card */}
                  <TextInput
                    style={styles.modalInput}
                    placeholder="PAN Card *"
                    value={editPanCard}
                    onChangeText={setEditPanCard}
                    autoCapitalize="characters"
                    maxLength={10}
                  />

                  <View style={styles.modalButtons}>
                    <Pressable
                      style={[styles.modalButton, styles.cancelButton]}
                      onPress={() => setIsEditing(false)}
                    >
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modalButton, styles.saveButton]}
                      onPress={handleSaveEdit}
                    >
                      <Text style={styles.saveText}>Save</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                /* View Mode */
                <>
                  {selectedDriver?.photoUrl && selectedDriver.photoUrl.startsWith('data:') && (
                    <Image
                      source={{ uri: selectedDriver.photoUrl }}
                      style={styles.largePhoto}
                    />
                  )}

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Full Name:</Text>
                    <Text style={styles.detailValue}>{selectedDriver?.fullName}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Age:</Text>
                    <Text style={styles.detailValue}>{selectedDriver?.age}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Address:</Text>
                    <Text style={styles.detailValue}>{selectedDriver?.address}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Aadhaar:</Text>
                    <Text style={styles.detailValue}>{selectedDriver?.aadhaarCard}</Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>PAN Card:</Text>
                    <Text style={styles.detailValue}>{selectedDriver?.panCard}</Text>
                  </View>

                  <View style={styles.viewModalButtons}>
                    <Pressable
                      style={[styles.modalButton, styles.editButtonStyle]}
                      onPress={handleEditPress}
                    >
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.modalButton, styles.deleteButtonStyle]}
                      onPress={handleDeleteDriver}
                    >
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={styles.closeButton}
                    onPress={() => {
                      setViewModalVisible(false);
                      setIsEditing(false);
                    }}
                  >
                    <Text style={styles.cancelText}>Close</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = {
  container: { flex: 1, backgroundColor: '#f3f4f6' } as const,
  scrollContent: { padding: 20, paddingBottom: 100 } as const,

  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 24,
  },
  backButton: { fontSize: 16, color: '#1d4ed8', fontWeight: '600' as const },
  headerTitle: { fontSize: 28, fontWeight: '700' as const, color: '#111827' },

  driversList: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  driverCard: {
    flexDirection: 'row' as const,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'center' as const,
  },
  driverPhoto: { width: 60, height: 60, borderRadius: 30, marginRight: 16 },
  noPhoto: { backgroundColor: '#e5e7eb', justifyContent: 'center' as const, alignItems: 'center' as const },
  noPhotoText: { fontSize: 12, color: '#6b7280' },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '600' as const, color: '#111827' },
  driverAge: { fontSize: 14, color: '#6b7280' },
  driverAddress: { fontSize: 12, color: '#9ca3af' },
  driverId: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  chevron: { fontSize: 24, color: '#d1d5db' },

  emptyText: { fontSize: 16, color: '#6b7280', textAlign: 'center' as const, padding: 20 },

  fab: {
    position: 'absolute' as const,
    right: 20,
    bottom: 30,
    backgroundColor: '#1d4ed8',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 32, fontWeight: '300' as const },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  modalContent: {
    backgroundColor: '#fff',
    width: '92%' as const,
    maxHeight: '88%' as const,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#111827',
    textAlign: 'center' as const,
    marginBottom: 16,
  },

  photoSection: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: 'hidden' as const,
  },
  photoPreview: {
    width: '100%' as const,
    height: 200,
    borderRadius: 12,
  },
  photoPlaceholder: {
    width: '100%' as const,
    height: 120,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d1d5db',
  },
  photoPlaceholderText: { fontSize: 20 },
  largePhoto: { width: '100%' as const, height: 250, borderRadius: 12, marginBottom: 20 },

  modalInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#f9fafb',
    marginBottom: 14,
  },
  textAreaInput: { height: 100, textAlignVertical: 'top' as const },

  modalButtons: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  cancelButton: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  saveButton: { backgroundColor: '#10b981' },
  cancelText: { color: '#6b7280', fontWeight: '600' as const },
  saveText: { color: '#fff', fontWeight: '600' as const },

  viewModalButtons: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 20,
  },
  editButtonStyle: { flex: 1, backgroundColor: '#3b82f6' },
  editButtonText: { color: '#fff', fontWeight: '600' as const },
  deleteButtonStyle: { flex: 1, backgroundColor: '#ef4444' },
  deleteButtonText: { color: '#fff', fontWeight: '600' as const },

  closeButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center' as const,
    marginTop: 12,
    backgroundColor: '#f3f4f6',
  },

  detailRow: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  detailLabel: { fontSize: 14, fontWeight: '600' as const, color: '#6b7280' },
  detailValue: { fontSize: 16, color: '#111827', marginTop: 4 },
};
