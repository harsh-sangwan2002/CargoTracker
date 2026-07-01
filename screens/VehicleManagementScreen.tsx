import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  PanResponder,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getVehicles, addVehicle, updateVehicle, deleteVehicle, Vehicle } from '../services/vehicleService';
import { getMaintenanceByVehicle, addVehicleMaintenance, deleteVehicleMaintenance, VehicleMaintenance } from '../services/vehicleMaintenanceService';
import { auth } from '../supabaseConfig';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerList } from '../components/Shimmer';

const emptyForm = {
  registrationNumber: '',
  type: '',
  capacityTons: '',
  insuranceExpiry: '',
  permitExpiry: '',
  pucExpiry: '',
};

const emptyMaintenanceForm = {
  maintenanceType: 'service',
  description: '',
  cost: '',
  odometerAtService: '',
  serviceDate: new Date().toISOString().slice(0, 10),
  nextServiceDueDate: '',
  nextServiceDueOdometer: '',
  vendor: '',
};

const isMaintenanceDue = (dateStr?: string) => {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const daysUntil = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntil <= 30;
};

const isValidDate = (v: string) => !v.trim() || /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

const isExpiringSoon = (dateStr?: string) => {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const daysUntil = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysUntil <= 30;
};

export default function VehicleManagementScreen() {
  const navigation = useNavigation<any>();
  const [vehicles, setVehicles] = useState<(Vehicle & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selected, setSelected] = useState<(Vehicle & { id: string }) | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [serviceModal, setServiceModal] = useState(false);
  const [serviceVehicle, setServiceVehicle] = useState<(Vehicle & { id: string }) | null>(null);
  const [maintenanceEntries, setMaintenanceEntries] = useState<(VehicleMaintenance & { id: string })[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState(emptyMaintenanceForm);
  const [showAddMaintenance, setShowAddMaintenance] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);

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

  const editSwipeY = useRef(new Animated.Value(0)).current;
  const editModalPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_, gs) => { if (gs.dy > 0) editSwipeY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 120 || gs.vy > 0.5) {
        Animated.timing(editSwipeY, { toValue: 800, duration: 200, useNativeDriver: true })
          .start(() => { editSwipeY.setValue(0); setEditModal(false); });
      } else {
        Animated.spring(editSwipeY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  const load = async () => {
    setLoading(true);
    try {
      const data = await getVehicles();
      setVehicles(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = vehicles.filter(v =>
    v.registrationNumber.toLowerCase().includes(searchQ.toLowerCase())
  );

  const setField = (key: keyof typeof emptyForm, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  const handleAdd = async () => {
    if (!form.registrationNumber.trim()) {
      Alert.alert('Required', 'Please enter a registration number.');
      return;
    }
    if (!isValidDate(form.insuranceExpiry) || !isValidDate(form.permitExpiry) || !isValidDate(form.pucExpiry)) {
      Alert.alert('Invalid Date', 'Expiry dates must be in YYYY-MM-DD format.');
      return;
    }
    setSaving(true);
    try {
      await addVehicle({
        registrationNumber: form.registrationNumber.trim(),
        type: form.type.trim(),
        capacityTons: form.capacityTons.trim() ? parseFloat(form.capacityTons) : undefined,
        status: 'active',
        insuranceExpiry: form.insuranceExpiry.trim(),
        permitExpiry: form.permitExpiry.trim(),
        pucExpiry: form.pucExpiry.trim(),
      });
      setAddModal(false);
      setForm(emptyForm);
      load();
    } catch {
      Alert.alert('Error', 'Failed to add vehicle. Registration number may already exist.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (vehicle: Vehicle & { id: string }) => {
    setSelected(vehicle);
    setForm({
      registrationNumber: vehicle.registrationNumber,
      type: vehicle.type ?? '',
      capacityTons: vehicle.capacityTons?.toString() ?? '',
      insuranceExpiry: vehicle.insuranceExpiry ?? '',
      permitExpiry: vehicle.permitExpiry ?? '',
      pucExpiry: vehicle.pucExpiry ?? '',
    });
    setEditModal(true);
  };

  const handleEdit = async () => {
    if (!selected || !form.registrationNumber.trim()) return;
    if (!isValidDate(form.insuranceExpiry) || !isValidDate(form.permitExpiry) || !isValidDate(form.pucExpiry)) {
      Alert.alert('Invalid Date', 'Expiry dates must be in YYYY-MM-DD format.');
      return;
    }
    setSaving(true);
    try {
      await updateVehicle(selected.id, {
        registrationNumber: form.registrationNumber.trim(),
        type: form.type.trim(),
        capacityTons: form.capacityTons.trim() ? parseFloat(form.capacityTons) : undefined,
        insuranceExpiry: form.insuranceExpiry.trim(),
        permitExpiry: form.permitExpiry.trim(),
        pucExpiry: form.pucExpiry.trim(),
      });
      setEditModal(false);
      setSelected(null);
      load();
    } catch {
      Alert.alert('Error', 'Failed to update vehicle.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (vehicle: Vehicle & { id: string }) => {
    Alert.alert('Delete Vehicle', `Remove "${vehicle.registrationNumber}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVehicle(vehicle.id);
            load();
          } catch {
            Alert.alert('Error', 'Failed to delete vehicle.');
          }
        },
      },
    ]);
  };

  const openServiceLog = async (vehicle: Vehicle & { id: string }) => {
    setServiceVehicle(vehicle);
    setServiceModal(true);
    setShowAddMaintenance(false);
    setMaintenanceForm(emptyMaintenanceForm);
    setMaintenanceLoading(true);
    try {
      setMaintenanceEntries(await getMaintenanceByVehicle(vehicle.id));
    } catch {
      setMaintenanceEntries([]);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const setMaintenanceField = (key: keyof typeof emptyMaintenanceForm, val: string) =>
    setMaintenanceForm(prev => ({ ...prev, [key]: val }));

  const handleAddMaintenance = async () => {
    if (!serviceVehicle) return;
    if (!maintenanceForm.serviceDate.trim()) {
      Alert.alert('Required', 'Please enter a service date.');
      return;
    }
    if (!isValidDate(maintenanceForm.serviceDate) || !isValidDate(maintenanceForm.nextServiceDueDate)) {
      Alert.alert('Invalid Date', 'Dates must be in YYYY-MM-DD format.');
      return;
    }
    setSavingMaintenance(true);
    try {
      await addVehicleMaintenance({
        vehicleId: serviceVehicle.id,
        maintenanceType: maintenanceForm.maintenanceType.trim() || 'service',
        description: maintenanceForm.description.trim(),
        cost: maintenanceForm.cost.trim() ? parseFloat(maintenanceForm.cost) : undefined,
        odometerAtService: maintenanceForm.odometerAtService.trim() ? parseFloat(maintenanceForm.odometerAtService) : undefined,
        serviceDate: maintenanceForm.serviceDate.trim(),
        nextServiceDueDate: maintenanceForm.nextServiceDueDate.trim() || undefined,
        nextServiceDueOdometer: maintenanceForm.nextServiceDueOdometer.trim() ? parseFloat(maintenanceForm.nextServiceDueOdometer) : undefined,
        vendor: maintenanceForm.vendor.trim(),
        createdBy: auth.currentUser?.uid,
      });
      setMaintenanceEntries(await getMaintenanceByVehicle(serviceVehicle.id));
      setMaintenanceForm(emptyMaintenanceForm);
      setShowAddMaintenance(false);
    } catch {
      Alert.alert('Error', 'Failed to add service record.');
    } finally {
      setSavingMaintenance(false);
    }
  };

  const handleDeleteMaintenance = (id: string) => {
    Alert.alert('Delete Record', 'Remove this service record?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVehicleMaintenance(id);
            if (serviceVehicle) setMaintenanceEntries(await getMaintenanceByVehicle(serviceVehicle.id));
          } catch {
            Alert.alert('Error', 'Failed to delete record.');
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.pageTitle}>Vehicles</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => { setForm(emptyForm); setAddModal(true); }} activeOpacity={0.85}>
          <Text style={s.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search vehicles..."
          placeholderTextColor={Colors.textMuted}
          value={searchQ}
          onChangeText={setSearchQ}
          autoCapitalize="characters"
        />
      </View>

      {loading ? (
        <ShimmerList count={6} style={{ padding: Spacing[3] }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🚛</Text>
              <Text style={s.emptyText}>No vehicles found</Text>
              <Text style={s.emptySub}>Tap "+ Add" to register your first vehicle.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const expiring = isExpiringSoon(item.insuranceExpiry) || isExpiringSoon(item.permitExpiry) || isExpiringSoon(item.pucExpiry);
            return (
              <View style={s.card}>
                <View style={s.cardIcon}>
                  <Text style={s.cardIconText}>🚛</Text>
                </View>
                <View style={s.cardContent}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.cardName}>{item.registrationNumber}</Text>
                    {expiring && (
                      <View style={s.expiryBadge}>
                        <Text style={s.expiryBadgeText}>⚠ Docs expiring</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.cardMeta}>
                    {[item.type, item.capacityTons ? `${item.capacityTons}T` : null].filter(Boolean).join(' · ') || 'No details'}
                  </Text>
                </View>
                <View style={s.cardActions}>
                  <TouchableOpacity style={s.editBtn} onPress={() => openServiceLog(item)} activeOpacity={0.8}>
                    <Text style={s.editBtnText}>Service</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.editBtn} onPress={() => openEdit(item)} activeOpacity={0.8}>
                    <Text style={s.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(item)} activeOpacity={0.8}>
                    <Text style={s.delBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Add Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { transform: [{ translateY: addSwipeY }] }]}>
            <View style={m.dragHeader} {...addModalPan.panHandlers}>
              <View style={m.handle} />
              <Text style={m.title}>Add Vehicle</Text>
            </View>

            <Text style={m.label}>Registration Number *</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. HR26AB1234"
              placeholderTextColor={Colors.textMuted}
              value={form.registrationNumber}
              onChangeText={t => setField('registrationNumber', t)}
              autoCapitalize="characters"
              autoFocus
            />
            <Text style={m.label}>Type (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Truck, Trailer, Tanker"
              placeholderTextColor={Colors.textMuted}
              value={form.type}
              onChangeText={t => setField('type', t)}
              autoCapitalize="words"
            />
            <Text style={m.label}>Capacity in tons (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. 20"
              placeholderTextColor={Colors.textMuted}
              value={form.capacityTons}
              onChangeText={t => setField('capacityTons', t)}
              keyboardType="decimal-pad"
            />
            <Text style={m.label}>Insurance Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.insuranceExpiry}
              onChangeText={t => setField('insuranceExpiry', t)}
            />
            <Text style={m.label}>Permit Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.permitExpiry}
              onChangeText={t => setField('permitExpiry', t)}
            />
            <Text style={m.label}>PUC Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.pucExpiry}
              onChangeText={t => setField('pucExpiry', t)}
            />

            <View style={m.btns}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setAddModal(false)} disabled={saving}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleAdd} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveText}>Add Vehicle</Text>}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { transform: [{ translateY: editSwipeY }] }]}>
            <View style={m.dragHeader} {...editModalPan.panHandlers}>
              <View style={m.handle} />
              <Text style={m.title}>Edit Vehicle</Text>
            </View>

            <Text style={m.label}>Registration Number *</Text>
            <TextInput
              style={m.input}
              value={form.registrationNumber}
              onChangeText={t => setField('registrationNumber', t)}
              autoCapitalize="characters"
              autoFocus
            />
            <Text style={m.label}>Type (optional)</Text>
            <TextInput
              style={m.input}
              value={form.type}
              onChangeText={t => setField('type', t)}
              autoCapitalize="words"
            />
            <Text style={m.label}>Capacity in tons (optional)</Text>
            <TextInput
              style={m.input}
              value={form.capacityTons}
              onChangeText={t => setField('capacityTons', t)}
              keyboardType="decimal-pad"
            />
            <Text style={m.label}>Insurance Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.insuranceExpiry}
              onChangeText={t => setField('insuranceExpiry', t)}
            />
            <Text style={m.label}>Permit Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.permitExpiry}
              onChangeText={t => setField('permitExpiry', t)}
            />
            <Text style={m.label}>PUC Expiry (optional, YYYY-MM-DD)</Text>
            <TextInput
              style={m.input}
              placeholder="2027-01-31"
              placeholderTextColor={Colors.textMuted}
              value={form.pucExpiry}
              onChangeText={t => setField('pucExpiry', t)}
            />

            <View style={m.btns}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setEditModal(false)} disabled={saving}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleEdit} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Service Log Modal */}
      <Modal visible={serviceModal} transparent animationType="slide" onRequestClose={() => setServiceModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { maxHeight: '85%' }]}>
            <View style={m.dragHeader}>
              <View style={m.handle} />
              <Text style={m.title}>{serviceVehicle?.registrationNumber} · Service Log</Text>
            </View>

            {maintenanceLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing[6] }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {maintenanceEntries.length === 0 && !showAddMaintenance && (
                  <Text style={{ color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing[4] }}>
                    No service records yet.
                  </Text>
                )}
                {maintenanceEntries.map(entry => (
                  <View key={entry.id} style={svc.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={svc.rowTitle}>
                        {entry.maintenanceType} · {entry.serviceDate}
                        {isMaintenanceDue(entry.nextServiceDueDate) ? '  ⚠ due soon' : ''}
                      </Text>
                      <Text style={svc.rowSub}>
                        {[entry.description, entry.vendor, entry.cost ? `₹${entry.cost}` : null].filter(Boolean).join(' · ') || '—'}
                      </Text>
                      {entry.nextServiceDueDate && (
                        <Text style={svc.rowSub}>Next due: {entry.nextServiceDueDate}</Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => handleDeleteMaintenance(entry.id)} activeOpacity={0.8}>
                      <Text style={{ color: Colors.danger, fontSize: FontSize.sm }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {showAddMaintenance ? (
                  <>
                    <Text style={m.label}>Type</Text>
                    <TextInput style={m.input} placeholder="service / repair / tyre / inspection" placeholderTextColor={Colors.textMuted} value={maintenanceForm.maintenanceType} onChangeText={t => setMaintenanceField('maintenanceType', t)} />
                    <Text style={m.label}>Description</Text>
                    <TextInput style={m.input} placeholder="e.g. Oil change + filter" placeholderTextColor={Colors.textMuted} value={maintenanceForm.description} onChangeText={t => setMaintenanceField('description', t)} />
                    <Text style={m.label}>Service Date (YYYY-MM-DD)</Text>
                    <TextInput style={m.input} value={maintenanceForm.serviceDate} onChangeText={t => setMaintenanceField('serviceDate', t)} />
                    <Text style={m.label}>Cost (optional)</Text>
                    <TextInput style={m.input} keyboardType="decimal-pad" value={maintenanceForm.cost} onChangeText={t => setMaintenanceField('cost', t)} />
                    <Text style={m.label}>Odometer at Service (optional)</Text>
                    <TextInput style={m.input} keyboardType="decimal-pad" value={maintenanceForm.odometerAtService} onChangeText={t => setMaintenanceField('odometerAtService', t)} />
                    <Text style={m.label}>Next Due Date (optional, YYYY-MM-DD)</Text>
                    <TextInput style={m.input} value={maintenanceForm.nextServiceDueDate} onChangeText={t => setMaintenanceField('nextServiceDueDate', t)} />
                    <Text style={m.label}>Next Due Odometer (optional)</Text>
                    <TextInput style={m.input} keyboardType="decimal-pad" value={maintenanceForm.nextServiceDueOdometer} onChangeText={t => setMaintenanceField('nextServiceDueOdometer', t)} />
                    <Text style={m.label}>Vendor (optional)</Text>
                    <TextInput style={m.input} value={maintenanceForm.vendor} onChangeText={t => setMaintenanceField('vendor', t)} />

                    <View style={m.btns}>
                      <TouchableOpacity style={m.cancelBtn} onPress={() => setShowAddMaintenance(false)} disabled={savingMaintenance}>
                        <Text style={m.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={m.saveBtn} onPress={handleAddMaintenance} disabled={savingMaintenance} activeOpacity={0.85}>
                        {savingMaintenance ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveText}>Save Record</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <TouchableOpacity style={svc.addBtn} onPress={() => setShowAddMaintenance(true)} activeOpacity={0.85}>
                    <Text style={svc.addBtnText}>+ Add Service Record</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}

            <TouchableOpacity style={[m.cancelBtn, { marginTop: Spacing[4] }]} onPress={() => setServiceModal(false)}>
              <Text style={m.cancelText}>Close</Text>
            </TouchableOpacity>
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
  pageTitle: { fontSize: FontSize['2xl'], fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
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
  },

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
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: Spacing[3],
  },
  cardIconText: { fontSize: 22 },
  cardContent: { flex: 1 } as const,
  cardName: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text },
  cardMeta: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  expiryBadge: { backgroundColor: Colors.dangerLight, borderRadius: Radius.full, paddingHorizontal: Spacing[2], paddingVertical: 2 },
  expiryBadgeText: { fontSize: 10, color: Colors.danger, fontWeight: '700' as const },
  cardActions: { flexDirection: 'row' as const, gap: Spacing[2] },
  editBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
  },
  editBtnText: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' as const },
  delBtn: {
    backgroundColor: Colors.dangerLight,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
  },
  delBtnText: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: '700' as const },

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
    padding: Spacing[6],
  },
  dragHeader: {
    alignItems: 'center' as const,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[4],
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
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: Spacing[2] },
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
  },
  btns: { flexDirection: 'row' as const, gap: Spacing[3], marginTop: Spacing[2] },
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

const svc = {
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowTitle: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.text, textTransform: 'capitalize' as const },
  rowSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  addBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.md,
    paddingVertical: 12,
    alignItems: 'center' as const,
    marginTop: Spacing[3],
  },
  addBtnText: { color: Colors.primary, fontWeight: '700' as const, fontSize: FontSize.sm },
};
