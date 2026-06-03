import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Alert,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { getTrips, getTripsByUser, addTrip, updateTrip, deleteTrip, TripFirestore } from '../services/tripService';
import { getDrivers, Driver } from '../services/driverService';
import { getPlants, seedDefaultPlantsIfEmpty, Plant } from '../services/plantService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole } from './MainTabsScreen';

interface Props {
  role: UserRole;
}

const PAGE_SIZE = 20;

const fmt = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

const fmtShort = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

/* ─── Dropdown Component ─────────────────────────────────────────── */
interface DropdownProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  suggestions: string[];
  onSelect: (s: string) => void;
  placeholder?: string;
  zIndex?: number;
}
function DropdownInput({ label, value, onChangeText, suggestions, onSelect, placeholder, zIndex = 10 }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const filtered = value.trim()
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;

  return (
    <View style={{ marginBottom: Spacing[3], zIndex, elevation: zIndex }}>
      <Text style={inp.label}>{label}</Text>
      <TextInput
        style={inp.field}
        placeholder={placeholder ?? label}
        placeholderTextColor={Colors.textMuted}
        value={value}
        onChangeText={t => { onChangeText(t); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoCapitalize="words"
      />
      {open && filtered.length > 0 && (
        <View style={inp.dropdown}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 160 }}>
            {filtered.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={[inp.item, i === filtered.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => { onSelect(s); onChangeText(s); setOpen(false); }}
              >
                <Text style={inp.itemText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/* ─── Driver dropdown (shows name + vehicle) ─────────────────────── */
interface DriverDropProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  drivers: (Driver & { id: string })[];
  onSelect: (name: string) => void;
  zIndex?: number;
}
function DriverDropdown({ label, value, onChangeText, drivers, onSelect, zIndex = 50 }: DriverDropProps) {
  const [open, setOpen] = useState(false);
  const filtered = value.trim()
    ? drivers.filter(d => d.fullName.toLowerCase().includes(value.toLowerCase()))
    : drivers;

  return (
    <View style={{ marginBottom: Spacing[3], zIndex, elevation: zIndex }}>
      <Text style={inp.label}>{label}</Text>
      <TextInput
        style={inp.field}
        placeholder="Type or select driver"
        placeholderTextColor={Colors.textMuted}
        value={value}
        onChangeText={t => { onChangeText(t); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoCapitalize="words"
      />
      {open && filtered.length > 0 && (
        <View style={inp.dropdown}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 160 }}>
            {filtered.map((d, i) => (
              <TouchableOpacity
                key={d.id}
                style={[inp.item, i === filtered.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => { onSelect(d.fullName); onChangeText(d.fullName); setOpen(false); }}
              >
                <Text style={inp.itemText}>{d.fullName}</Text>
                {d.vehicleOwned ? <Text style={inp.itemSub}>{d.vehicleOwned}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/* ─── Date picker button ─────────────────────────────────────────── */
interface DateBtnProps {
  label: string;
  value: Date | null;
  onPress: () => void;
}
function DateBtn({ label, value, onPress }: DateBtnProps) {
  return (
    <TouchableOpacity style={inp.dateBtn} onPress={onPress} activeOpacity={0.8}>
      <Text style={inp.dateBtnLabel}>{label}</Text>
      <Text style={[inp.dateBtnValue, value && { color: Colors.text, fontWeight: '600' as const }]}>
        {value ? fmt(value) : 'Tap to select'}
      </Text>
    </TouchableOpacity>
  );
}

/* ─── Trip Form ──────────────────────────────────────────────────── */
interface FormState {
  vehicleNo: string;
  lrNo: string;
  driverName: string;
  companyName: string;
  itemType: string;
  quantity: string;
  fuelFilled: string;
  distanceTravelled: string;
  fromPlant: string;
  toPlant: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
}

const emptyForm = (): FormState => ({
  vehicleNo: '', lrNo: '', driverName: '', companyName: '',
  itemType: '', quantity: '', fuelFilled: '', distanceTravelled: '',
  fromPlant: '', toPlant: '', departureTime: null, arrivalTime: null,
});

const tripToForm = (t: TripFirestore & { id: string }): FormState => ({
  vehicleNo: t.truck,
  lrNo: t.bidNo,
  driverName: t.driverName,
  companyName: t.companyName,
  itemType: t.itemType,
  quantity: t.quantity,
  fuelFilled: t.fuelFilled,
  distanceTravelled: t.distanceTravelled ?? '',
  fromPlant: t.fromPlant,
  toPlant: t.toPlant,
  departureTime: t.departureTime,
  arrivalTime: t.arrivalTime,
});

/* ─── Main Screen ────────────────────────────────────────────────── */
export default function TripsScreen({ role }: Props) {
  const user = auth.currentUser;
  const [trips, setTrips] = useState<(TripFirestore & { id: string })[]>([]);
  const [displayedTrips, setDisplayedTrips] = useState<(TripFirestore & { id: string })[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'delivered'>('all');

  const [plants, setPlants] = useState<string[]>([]);
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);

  // Add modal
  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  // View/Edit modal
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState<(TripFirestore & { id: string }) | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());

  // Date pickers
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [showArrPicker, setShowArrPicker] = useState(false);
  const [pickerCtx, setPickerCtx] = useState<'add' | 'edit'>('add');
  const [tempDate, setTempDate] = useState(new Date());
  const [pickerMode, setPickerMode] = useState<'departure' | 'arrival'>('departure');

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [fetchedTrips, fetchedDrivers] = await Promise.all([
        role === 'driver' ? getTripsByUser(user?.uid ?? '') : getTrips(),
        getDrivers(),
      ]);
      await seedDefaultPlantsIfEmpty();
      const fetchedPlants = await getPlants();
      setTrips(fetchedTrips);
      setDrivers(fetchedDrivers);
      setPlants(fetchedPlants.map(p => p.name));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Filter + paginate
  useEffect(() => {
    let filtered = trips;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      filtered = filtered.filter(t =>
        t.truck.toLowerCase().includes(q) || t.driverName.toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'active') filtered = filtered.filter(t => !t.arrivalTime);
    if (statusFilter === 'delivered') filtered = filtered.filter(t => !!t.arrivalTime);
    setDisplayedTrips(filtered.slice(0, page * PAGE_SIZE));
  }, [trips, searchQ, statusFilter, page]);

  const setField = (key: keyof FormState, val: string | Date | null) =>
    setForm(prev => ({ ...prev, [key]: val }));
  const setEditField = (key: keyof FormState, val: string | Date | null) =>
    setEditForm(prev => ({ ...prev, [key]: val }));

  const handleAddTrip = async () => {
    const { vehicleNo, lrNo, driverName, companyName, itemType, quantity, fromPlant, toPlant, departureTime } = form;
    if (!vehicleNo.trim() || !lrNo.trim() || !driverName.trim() || !companyName.trim() ||
      !itemType.trim() || !quantity.trim() || !fromPlant.trim() || !toPlant.trim() || !departureTime) {
      Alert.alert('Required Fields', 'Please fill all required fields (*).');
      return;
    }
    setSaving(true);
    try {
      await addTrip({
        truck: vehicleNo.trim().toUpperCase(),
        bidNo: lrNo.trim(),
        driverName: driverName.trim(),
        companyName: companyName.trim(),
        itemType: itemType.trim(),
        quantity: quantity.trim(),
        fuelFilled: form.fuelFilled.trim() || '0',
        distanceTravelled: form.distanceTravelled.trim() || '0',
        fromPlant: fromPlant.trim(),
        toPlant: toPlant.trim(),
        departureTime: departureTime,
        arrivalTime: form.arrivalTime,
        status: form.arrivalTime ? 'Delivered' : 'Active',
        time: 'Just now',
        userId: user?.uid ?? '',
      });
      Alert.alert('Success', `Trip added for ${vehicleNo.trim().toUpperCase()}`);
      setForm(emptyForm());
      setAddModal(false);
      loadAll(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to add trip.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    const f = editForm;
    if (!f.vehicleNo.trim() || !f.lrNo.trim() || !f.driverName.trim() || !f.companyName.trim() ||
      !f.itemType.trim() || !f.quantity.trim() || !f.fromPlant.trim() || !f.toPlant.trim() || !f.departureTime) {
      Alert.alert('Required Fields', 'Please fill all required fields (*).');
      return;
    }
    setSaving(true);
    try {
      await updateTrip(selected.id, {
        truck: f.vehicleNo.trim().toUpperCase(),
        bidNo: f.lrNo.trim(),
        driverName: f.driverName.trim(),
        companyName: f.companyName.trim(),
        itemType: f.itemType.trim(),
        quantity: f.quantity.trim(),
        fuelFilled: f.fuelFilled.trim() || '0',
        distanceTravelled: f.distanceTravelled.trim() || '0',
        fromPlant: f.fromPlant.trim(),
        toPlant: f.toPlant.trim(),
        departureTime: f.departureTime!,
        arrivalTime: f.arrivalTime,
        status: f.arrivalTime ? 'Delivered' : 'Active',
      });
      setIsEditing(false);
      setViewModal(false);
      setSelected(null);
      loadAll(true);
    } catch (e) {
      Alert.alert('Error', 'Failed to update trip.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!selected) return;
    Alert.alert('Delete Trip', 'Are you sure you want to delete this trip?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTrip(selected.id);
            setViewModal(false);
            setSelected(null);
            loadAll(true);
          } catch {
            Alert.alert('Error', 'Failed to delete trip.');
          }
        },
      },
    ]);
  };

  const openAdd = () => {
    setForm(emptyForm());
    setAddModal(true);
  };

  const openView = (t: TripFirestore & { id: string }) => {
    setSelected(t);
    setIsEditing(false);
    setViewModal(true);
  };

  const openEdit = () => {
    if (selected) { setEditForm(tripToForm(selected)); setIsEditing(true); }
  };

  const openDatePicker = (ctx: 'add' | 'edit', mode: 'departure' | 'arrival') => {
    const current = ctx === 'add'
      ? (mode === 'departure' ? form.departureTime : form.arrivalTime)
      : (mode === 'departure' ? editForm.departureTime : editForm.arrivalTime);
    setTempDate(current ?? new Date());
    setPickerCtx(ctx);
    setPickerMode(mode);
    if (mode === 'departure') setShowDepPicker(true);
    else setShowArrPicker(true);
  };

  const applyDate = (date: Date) => {
    if (pickerCtx === 'add') {
      if (pickerMode === 'departure') setField('departureTime', date);
      else setField('arrivalTime', date);
    } else {
      if (pickerMode === 'departure') setEditField('departureTime', date);
      else setEditField('arrivalTime', date);
    }
  };

  const allCount = trips.length;
  const activeCount = trips.filter(t => !t.arrivalTime).length;
  const delivCount = trips.filter(t => !!t.arrivalTime).length;
  const hasMore = displayedTrips.length < (statusFilter === 'all' ? trips.length : displayedTrips.length);

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.topBar}>
        <Text style={s.pageTitle}>Trips</Text>
        <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.85}>
          <Text style={s.addBtnText}>+ Add Trip</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search vehicle or driver..."
          placeholderTextColor={Colors.textMuted}
          value={searchQ}
          onChangeText={t => { setSearchQ(t); setPage(1); }}
          returnKeyType="search"
        />
      </View>

      {/* Status Tabs */}
      <View style={s.filterRow}>
        {([
          { key: 'all', label: `All (${allCount})` },
          { key: 'active', label: `Active (${activeCount})` },
          { key: 'delivered', label: `Delivered (${delivCount})` },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.filterTab, statusFilter === tab.key && s.filterTabActive]}
            onPress={() => { setStatusFilter(tab.key); setPage(1); }}
            activeOpacity={0.8}
          >
            <Text style={[s.filterTabText, statusFilter === tab.key && s.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={s.loaderCenter}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingTxt}>Loading trips...</Text>
        </View>
      ) : (
        <FlatList
          data={displayedTrips}
          keyExtractor={item => item.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); setPage(1); loadAll(); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🚛</Text>
              <Text style={s.emptyText}>No trips found</Text>
              <Text style={s.emptySub}>
                {searchQ ? 'Try a different search term.' : 'Tap "+ Add Trip" to create one.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity style={s.loadMoreBtn} onPress={() => setPage(p => p + 1)} activeOpacity={0.8}>
                <Text style={s.loadMoreText}>Load More</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => {
            const delivered = !!item.arrivalTime;
            return (
              <TouchableOpacity style={s.card} onPress={() => openView(item)} activeOpacity={0.85}>
                <View style={s.cardTop}>
                  <View style={s.vehicleBadge}>
                    <Text style={s.vehicleText}>{item.truck}</Text>
                  </View>
                  <View style={[s.statusChip, { backgroundColor: delivered ? Colors.successLight : Colors.primaryLight }]}>
                    <Text style={[s.statusText, { color: delivered ? Colors.success : Colors.primary }]}>
                      {delivered ? 'Delivered' : 'Active'}
                    </Text>
                  </View>
                </View>
                <Text style={s.routeText}>
                  {item.fromPlant || '—'} → {item.toPlant || '—'}
                </Text>
                <View style={s.cardMeta}>
                  <Text style={s.metaText}>👤 {item.driverName || '—'}</Text>
                  <Text style={s.metaText}>📦 {item.quantity || '—'}</Text>
                </View>
                <View style={s.cardMeta}>
                  <Text style={s.metaText}>🕐 {fmtShort(item.departureTime)}</Text>
                  {item.fuelFilled && item.fuelFilled !== '0' && (
                    <Text style={s.metaText}>⛽ {item.fuelFilled} L</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* ─── DATE PICKER MODALS ─── */}
      {showDepPicker && (
        <Modal transparent visible animationType="slide">
          <View style={dp.overlay}>
            <View style={dp.sheet}>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                onChange={(_, d) => { if (d) setTempDate(d); if (Platform.OS === 'android') { if (d) applyDate(d); setShowDepPicker(false); } }}
              />
              {Platform.OS === 'ios' && (
                <Pressable style={dp.done} onPress={() => { applyDate(tempDate); setShowDepPicker(false); }}>
                  <Text style={dp.doneText}>Confirm</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      )}
      {showArrPicker && (
        <Modal transparent visible animationType="slide">
          <View style={dp.overlay}>
            <View style={dp.sheet}>
              <DateTimePicker
                value={tempDate}
                mode="datetime"
                display="spinner"
                onChange={(_, d) => { if (d) setTempDate(d); if (Platform.OS === 'android') { if (d) applyDate(d); setShowArrPicker(false); } }}
              />
              {Platform.OS === 'ios' && (
                <Pressable style={dp.done} onPress={() => { applyDate(tempDate); setShowArrPicker(false); }}>
                  <Text style={dp.doneText}>Confirm</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* ─── ADD TRIP MODAL ─── */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={m.title}>Add New Trip</Text>

              <View style={m.row}>
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>Vehicle No. *</Text>
                  <TextInput style={inp.field} value={form.vehicleNo} onChangeText={t => setField('vehicleNo', t)} placeholder="e.g. HR26AB1234" placeholderTextColor={Colors.textMuted} autoCapitalize="characters" />
                </View>
                <View style={{ width: Spacing[3] }} />
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>LR No. *</Text>
                  <TextInput style={inp.field} value={form.lrNo} onChangeText={t => setField('lrNo', t)} placeholder="LR Number" placeholderTextColor={Colors.textMuted} />
                </View>
              </View>

              <DriverDropdown
                label="Driver Name *"
                value={form.driverName}
                onChangeText={t => setField('driverName', t)}
                drivers={drivers}
                onSelect={name => setField('driverName', name)}
                zIndex={200}
              />

              <View style={m.row}>
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>Company *</Text>
                  <TextInput style={inp.field} value={form.companyName} onChangeText={t => setField('companyName', t)} placeholder="Company name" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />
                </View>
                <View style={{ width: Spacing[3] }} />
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>Item Type *</Text>
                  <TextInput style={inp.field} value={form.itemType} onChangeText={t => setField('itemType', t)} placeholder="e.g. PTA" placeholderTextColor={Colors.textMuted} autoCapitalize="words" />
                </View>
              </View>

              <View style={m.row}>
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>Quantity (tons) *</Text>
                  <TextInput style={inp.field} value={form.quantity} onChangeText={t => setField('quantity', t)} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                </View>
                <View style={{ width: Spacing[3] }} />
                <View style={{ flex: 1 }}>
                  <Text style={inp.label}>Fuel (liters)</Text>
                  <TextInput style={inp.field} value={form.fuelFilled} onChangeText={t => setField('fuelFilled', t)} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />
                </View>
              </View>

              <View style={{ zIndex: 120, elevation: 12 }}>
                <DropdownInput
                  label="From Plant *"
                  value={form.fromPlant}
                  onChangeText={t => setField('fromPlant', t)}
                  suggestions={plants}
                  onSelect={p => setField('fromPlant', p)}
                  zIndex={120}
                />
              </View>
              <View style={{ zIndex: 110, elevation: 11 }}>
                <DropdownInput
                  label="To Plant *"
                  value={form.toPlant}
                  onChangeText={t => setField('toPlant', t)}
                  suggestions={plants}
                  onSelect={p => setField('toPlant', p)}
                  zIndex={110}
                />
              </View>

              <View style={{ zIndex: 1 }}>
                <Text style={inp.label}>Distance (km)</Text>
                <TextInput style={inp.field} value={form.distanceTravelled} onChangeText={t => setField('distanceTravelled', t)} placeholder="Optional" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" />

                <DateBtn label="Departure Time *" value={form.departureTime} onPress={() => openDatePicker('add', 'departure')} />
                <DateBtn label="Arrival Time" value={form.arrivalTime} onPress={() => openDatePicker('add', 'arrival')} />
                {form.arrivalTime && (
                  <TouchableOpacity onPress={() => setField('arrivalTime', null)} style={m.clearBtn}>
                    <Text style={m.clearBtnText}>✕ Clear arrival time</Text>
                  </TouchableOpacity>
                )}

                <View style={m.btns}>
                  <TouchableOpacity style={m.cancelBtn} onPress={() => setAddModal(false)} disabled={saving}>
                    <Text style={m.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={m.saveBtn} onPress={handleAddTrip} disabled={saving} activeOpacity={0.85}>
                    {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveBtnText}>Save Trip</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── VIEW / EDIT MODAL ─── */}
      <Modal visible={viewModal} transparent animationType="slide" onRequestClose={() => { setViewModal(false); setIsEditing(false); }}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={m.title}>{isEditing ? 'Edit Trip' : 'Trip Details'}</Text>

              {isEditing ? (
                <>
                  <View style={m.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>Vehicle No. *</Text>
                      <TextInput style={inp.field} value={editForm.vehicleNo} onChangeText={t => setEditField('vehicleNo', t)} autoCapitalize="characters" />
                    </View>
                    <View style={{ width: Spacing[3] }} />
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>LR No. *</Text>
                      <TextInput style={inp.field} value={editForm.lrNo} onChangeText={t => setEditField('lrNo', t)} />
                    </View>
                  </View>

                  <DriverDropdown
                    label="Driver Name *"
                    value={editForm.driverName}
                    onChangeText={t => setEditField('driverName', t)}
                    drivers={drivers}
                    onSelect={name => setEditField('driverName', name)}
                    zIndex={200}
                  />

                  <View style={m.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>Company *</Text>
                      <TextInput style={inp.field} value={editForm.companyName} onChangeText={t => setEditField('companyName', t)} autoCapitalize="words" />
                    </View>
                    <View style={{ width: Spacing[3] }} />
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>Item Type *</Text>
                      <TextInput style={inp.field} value={editForm.itemType} onChangeText={t => setEditField('itemType', t)} autoCapitalize="words" />
                    </View>
                  </View>

                  <View style={m.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>Quantity (tons) *</Text>
                      <TextInput style={inp.field} value={editForm.quantity} onChangeText={t => setEditField('quantity', t)} keyboardType="decimal-pad" />
                    </View>
                    <View style={{ width: Spacing[3] }} />
                    <View style={{ flex: 1 }}>
                      <Text style={inp.label}>Fuel (L)</Text>
                      <TextInput style={inp.field} value={editForm.fuelFilled} onChangeText={t => setEditField('fuelFilled', t)} keyboardType="decimal-pad" />
                    </View>
                  </View>

                  <View style={{ zIndex: 120, elevation: 12 }}>
                    <DropdownInput label="From Plant *" value={editForm.fromPlant} onChangeText={t => setEditField('fromPlant', t)} suggestions={plants} onSelect={p => setEditField('fromPlant', p)} zIndex={120} />
                  </View>
                  <View style={{ zIndex: 110, elevation: 11 }}>
                    <DropdownInput label="To Plant *" value={editForm.toPlant} onChangeText={t => setEditField('toPlant', t)} suggestions={plants} onSelect={p => setEditField('toPlant', p)} zIndex={110} />
                  </View>

                  <View style={{ zIndex: 1 }}>
                    <Text style={inp.label}>Distance (km)</Text>
                    <TextInput style={[inp.field, { marginBottom: Spacing[3] }]} value={editForm.distanceTravelled} onChangeText={t => setEditField('distanceTravelled', t)} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={Colors.textMuted} />

                    <DateBtn label="Departure Time *" value={editForm.departureTime} onPress={() => openDatePicker('edit', 'departure')} />
                    <DateBtn label="Arrival Time" value={editForm.arrivalTime} onPress={() => openDatePicker('edit', 'arrival')} />
                    {editForm.arrivalTime && (
                      <TouchableOpacity onPress={() => setEditField('arrivalTime', null)} style={m.clearBtn}>
                        <Text style={m.clearBtnText}>✕ Clear arrival time</Text>
                      </TouchableOpacity>
                    )}

                    <View style={m.btns}>
                      <TouchableOpacity style={m.cancelBtn} onPress={() => setIsEditing(false)} disabled={saving}>
                        <Text style={m.cancelBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={m.saveBtn} onPress={handleSaveEdit} disabled={saving} activeOpacity={0.85}>
                        {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveBtnText}>Save Changes</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : (
                /* View Mode */
                <>
                  {[
                    { label: 'Vehicle', value: selected?.truck },
                    { label: 'LR No.', value: selected?.bidNo },
                    { label: 'Driver', value: selected?.driverName },
                    { label: 'Company', value: selected?.companyName },
                    { label: 'Item Type', value: selected?.itemType },
                    { label: 'Quantity', value: selected?.quantity ? `${selected.quantity} tons` : '—' },
                    { label: 'From Plant', value: selected?.fromPlant },
                    { label: 'To Plant', value: selected?.toPlant },
                    { label: 'Departure', value: fmt(selected?.departureTime ?? null) },
                    { label: 'Arrival', value: fmt(selected?.arrivalTime ?? null) },
                    { label: 'Fuel', value: selected?.fuelFilled ? `${selected.fuelFilled} L` : '—' },
                    { label: 'Distance', value: selected?.distanceTravelled && selected.distanceTravelled !== '0' ? `${selected.distanceTravelled} km` : '—' },
                    { label: 'Status', value: selected?.arrivalTime ? 'Delivered' : 'Active' },
                  ].map(row => (
                    <View key={row.label} style={dv.row}>
                      <Text style={dv.label}>{row.label}</Text>
                      <Text style={dv.value}>{row.value || '—'}</Text>
                    </View>
                  ))}

                  <View style={m.btns}>
                    <TouchableOpacity style={m.cancelBtn} onPress={() => { setViewModal(false); setSelected(null); }}>
                      <Text style={m.cancelBtnText}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[m.saveBtn, { backgroundColor: Colors.primary }]} onPress={openEdit} activeOpacity={0.85}>
                      <Text style={m.saveBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[m.saveBtn, { backgroundColor: Colors.danger }]} onPress={handleDelete} activeOpacity={0.85}>
                      <Text style={m.saveBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────
const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  topBar: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  pageTitle: { fontSize: FontSize['3xl'], fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
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

  filterRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: Spacing[5],
    marginBottom: Spacing[3],
    gap: Spacing[2],
  },
  filterTab: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterTabText: { fontSize: FontSize.xs, fontWeight: '600' as const, color: Colors.textSecondary },
  filterTabTextActive: { color: '#fff' },

  loaderCenter: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: Spacing[3],
  },
  loadingTxt: { fontSize: FontSize.sm, color: Colors.textSecondary },

  listContent: { paddingHorizontal: Spacing[5], paddingBottom: Spacing[10] } as const,

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[3],
    ...Shadow.md,
  },
  cardTop: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[2],
  },
  vehicleBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  vehicleText: { fontWeight: '800' as const, fontSize: FontSize.base, color: Colors.primary },
  statusChip: { paddingHorizontal: Spacing[2], paddingVertical: 3, borderRadius: Radius.full },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' as const },
  routeText: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.text, marginBottom: Spacing[2] },
  cardMeta: { flexDirection: 'row' as const, gap: Spacing[4], marginTop: 2 },
  metaText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  loadMoreBtn: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    marginTop: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadMoreText: { color: Colors.primary, fontWeight: '700' as const, fontSize: FontSize.base },

  empty: {
    alignItems: 'center' as const,
    paddingVertical: Spacing[12],
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.textSecondary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const },
};

const inp = {
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: Spacing[1] },
  field: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: 12,
    fontSize: FontSize.base,
    color: Colors.text,
    marginBottom: 0,
  },
  dropdown: {
    position: 'absolute' as const,
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.lg,
    overflow: 'hidden' as const,
  },
  item: {
    paddingVertical: 12,
    paddingHorizontal: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  itemText: { fontSize: FontSize.base, color: Colors.text },
  itemSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  dateBtn: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    paddingVertical: 12,
    marginBottom: Spacing[3],
  },
  dateBtnLabel: { fontSize: FontSize.xs, fontWeight: '600' as const, color: Colors.textMuted, marginBottom: 2 },
  dateBtnValue: { fontSize: FontSize.base, color: Colors.textMuted },
};

const m = {
  overlay: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing[5],
    maxHeight: '92%' as const,
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
  row: { flexDirection: 'row' as const, marginBottom: Spacing[3] },
  clearBtn: { marginBottom: Spacing[3] } as const,
  clearBtnText: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: '600' as const },
  btns: { flexDirection: 'row' as const, gap: Spacing[3], marginTop: Spacing[4] },
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
  saveBtn: {
    flex: 1,
    backgroundColor: Colors.success,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },
};

const dv = {
  row: {
    flexDirection: 'row' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    alignItems: 'flex-start' as const,
  },
  label: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary, width: 100 },
  value: { fontSize: FontSize.base, color: Colors.text, flex: 1, flexWrap: 'wrap' as const },
};

const dp = {
  overlay: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing[4],
  },
  done: {
    paddingVertical: 16,
    alignItems: 'center' as const,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  doneText: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '700' as const },
};
