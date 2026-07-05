import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getPlants, addPlant, updatePlant, deletePlant, Plant, seedDefaultPlantsIfEmpty } from '../services/plantService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerList } from '../components/Shimmer';

export default function PlantManagementScreen() {
  const navigation = useNavigation<any>();
  const [plants, setPlants] = useState<(Plant & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selectedPlant, setSelectedPlant] = useState<(Plant & { id: string }) | null>(null);
  const [plantName, setPlantName] = useState('');
  const [plantLocation, setPlantLocation] = useState('');
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
      await seedDefaultPlantsIfEmpty();
      const data = await getPlants();
      setPlants(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = plants.filter(p =>
    p.name.toLowerCase().includes(searchQ.toLowerCase())
  );

  const handleAdd = async () => {
    if (!plantName.trim()) {
      Alert.alert('Required', 'Please enter a plant name.');
      return;
    }
    setSaving(true);
    try {
      await addPlant({ name: plantName.trim(), location: plantLocation.trim() });
      setAddModal(false);
      setPlantName('');
      setPlantLocation('');
      load();
    } catch {
      Alert.alert('Error', 'Failed to add plant.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (plant: Plant & { id: string }) => {
    setSelectedPlant(plant);
    setPlantName(plant.name);
    setPlantLocation(plant.location ?? '');
    setEditModal(true);
  };

  const handleEdit = async () => {
    if (!selectedPlant || !plantName.trim()) return;
    setSaving(true);
    try {
      await updatePlant(selectedPlant.id, { name: plantName.trim(), location: plantLocation.trim() });
      setEditModal(false);
      setSelectedPlant(null);
      load();
    } catch {
      Alert.alert('Error', 'Failed to update plant.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (plant: Plant & { id: string }) => {
    Alert.alert('Delete Plant', `Remove "${plant.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlant(plant.id);
            load();
          } catch {
            Alert.alert('Error', 'Failed to delete plant.');
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
        <Text style={s.pageTitle}>Plants</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => { setPlantName(''); setPlantLocation(''); setAddModal(true); }} activeOpacity={0.85}>
          <Text style={s.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.search}
          placeholder="Search plants..."
          placeholderTextColor={Colors.textMuted}
          value={searchQ}
          onChangeText={setSearchQ}
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
              <Text style={s.emptyIcon}>🏭</Text>
              <Text style={s.emptyText}>No plants found</Text>
              <Text style={s.emptySub}>Tap "+ Add" to create your first plant.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.cardIcon}>
                <Text style={s.cardIconText}>🏭</Text>
              </View>
              <View style={s.cardContent}>
                <Text style={s.cardName}>{item.name}</Text>
                {item.location ? <Text style={s.cardLocation}>{item.location}</Text> : null}
              </View>
              <View style={s.cardActions}>
                <TouchableOpacity style={s.editBtn} onPress={() => openEdit(item)} activeOpacity={0.8}>
                  <Text style={s.editBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(item)} activeOpacity={0.8}>
                  <Text style={s.delBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Add Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Animated.View style={[m.sheet, { transform: [{ translateY: addSwipeY }] }]}>
            <View style={m.dragHeader} {...addModalPan.panHandlers}>
              <View style={m.handle} />
              <Text style={m.title}>Add Plant</Text>
            </View>

            <Text style={m.label}>Plant Name *</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. PTA Terminal IOCL"
              placeholderTextColor={Colors.textMuted}
              value={plantName}
              onChangeText={setPlantName}
              autoCapitalize="words"
              autoFocus
            />
            <Text style={m.label}>Location (optional)</Text>
            <TextInput
              style={m.input}
              placeholder="e.g. Delhi"
              placeholderTextColor={Colors.textMuted}
              value={plantLocation}
              onChangeText={setPlantLocation}
              autoCapitalize="words"
            />

            <View style={m.btns}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setAddModal(false)} disabled={saving}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={handleAdd} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveText}>Add Plant</Text>}
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
              <Text style={m.title}>Edit Plant</Text>
            </View>

            <Text style={m.label}>Plant Name *</Text>
            <TextInput
              style={m.input}
              value={plantName}
              onChangeText={setPlantName}
              autoCapitalize="words"
              autoFocus
            />
            <Text style={m.label}>Location (optional)</Text>
            <TextInput
              style={m.input}
              value={plantLocation}
              onChangeText={setPlantLocation}
              autoCapitalize="words"
              placeholder="e.g. Delhi"
              placeholderTextColor={Colors.textMuted}
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
  cardLocation: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
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
    letterSpacing: 0,
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
