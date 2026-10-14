import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../supabaseConfig';
import { getUserProfile } from '../services/userService';
import { getDrivers, Driver } from '../services/driverService';
import { getVehicles, Vehicle } from '../services/vehicleService';
import {
  addDocument,
  getComplianceAlerts,
  getJobRuns,
  runComplianceScan,
  runTripStatsRollup,
  ComplianceAlert,
  DocEntityType,
  DocType,
  DOC_TYPES_BY_ENTITY,
  PII_DOC_TYPES,
  JobRun,
} from '../services/documentService';
import { getPendingOfflineCount } from '../utils/offlineQueue';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerList } from '../components/Shimmer';

const WINDOWS = [30, 60, 90];

const SECTIONS: { kind: ComplianceAlert['kind']; title: string; icon: string }[] = [
  { kind: 'vehicle_doc', title: 'Vehicle papers', icon: '🚛' },
  { kind: 'driver_license', title: 'Driver licences', icon: '🪪' },
  { kind: 'document', title: 'Uploaded documents', icon: '📄' },
  { kind: 'maintenance', title: 'Service due', icon: '🔧' },
];

const ITEM_LABELS: Record<string, string> = {
  insurance: 'Insurance', permit: 'Permit', puc: 'PUC', license: 'Licence', rc: 'RC', fitness: 'Fitness',
  aadhaar: 'Aadhaar', pan: 'PAN', other: 'Document', service: 'Service', repair: 'Repair', tyre: 'Tyres',
  inspection: 'Inspection',
};
const itemLabel = (item: string) => ITEM_LABELS[item] ?? item;

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never';

function DueBadge({ alert }: { alert: ComplianceAlert }) {
  const overdueByKm = alert.dueOdometer != null && alert.currentOdometer != null && alert.currentOdometer >= alert.dueOdometer;
  const days = alert.daysLeft;
  let text: string;
  let tone: 'danger' | 'warning' | 'info';
  if ((days !== null && days < 0) || overdueByKm) {
    text = days !== null && days < 0 ? `${-days}d overdue` : 'Overdue';
    tone = 'danger';
  } else if (days !== null) {
    text = days === 0 ? 'Today' : `${days}d left`;
    tone = days <= 7 ? 'warning' : 'info';
  } else {
    text = 'Due soon';
    tone = 'warning';
  }
  const bg = tone === 'danger' ? Colors.dangerLight : tone === 'warning' ? Colors.warningLight : Colors.infoLight;
  const fg = tone === 'danger' ? Colors.danger : tone === 'warning' ? Colors.warning : Colors.info;
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export default function FleetHealthScreen() {
  const navigation = useNavigation<any>();
  const user = auth.currentUser;
  const [isAdmin, setIsAdmin] = useState(false);
  const [withinDays, setWithinDays] = useState(30);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // System health (admin)
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [pendingOffline, setPendingOffline] = useState(0);
  const [runningJob, setRunningJob] = useState<string | null>(null);

  // Add document
  const [docModal, setDocModal] = useState(false);
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);
  const [vehicles, setVehicles] = useState<(Vehicle & { id: string })[]>([]);
  const [docEntityType, setDocEntityType] = useState<DocEntityType>('vehicle');
  const [docEntityId, setDocEntityId] = useState<string>('');
  const [docType, setDocType] = useState<DocType>('insurance');
  const [docExpiry, setDocExpiry] = useState('');
  const [docUri, setDocUri] = useState<string | undefined>();
  const [entitySearch, setEntitySearch] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);

  const load = async () => {
    try {
      setLoadError(false);
      const [a] = await Promise.all([
        getComplianceAlerts(withinDays),
        getPendingOfflineCount().then(setPendingOffline).catch(() => {}),
      ]);
      setAlerts(a);
      if (isAdmin) setJobRuns(await getJobRuns().catch(() => []));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user?.uid) return;
    getUserProfile(user.uid).then(p => setIsAdmin(p?.role === 'admin')).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [withinDays, isAdmin]);

  const grouped = useMemo(() => {
    const map: Record<string, ComplianceAlert[]> = {};
    alerts.forEach(a => { (map[a.kind] ??= []).push(a); });
    return map;
  }, [alerts]);

  const overdueCount = alerts.filter(a =>
    (a.daysLeft !== null && a.daysLeft < 0) ||
    (a.dueOdometer != null && a.currentOdometer != null && a.currentOdometer >= a.dueOdometer)
  ).length;

  const openDocModal = async () => {
    setDocEntityType('vehicle');
    setDocType('insurance');
    setDocEntityId('');
    setDocExpiry('');
    setDocUri(undefined);
    setEntitySearch('');
    setDocModal(true);
    if (!drivers.length || !vehicles.length) {
      const [d, v] = await Promise.all([getDrivers(), getVehicles().catch(() => [])]);
      setDrivers(d);
      setVehicles(v);
    }
  };

  const allowedDocTypes = DOC_TYPES_BY_ENTITY[docEntityType].filter(t => isAdmin || !PII_DOC_TYPES.includes(t));

  const entityOptions = useMemo(() => {
    const q = entitySearch.trim().toLowerCase();
    const list = docEntityType === 'driver'
      ? drivers.map(d => ({ id: d.id, label: d.fullName || d.email || 'Unnamed driver' }))
      : vehicles.map(v => ({ id: v.id, label: v.registrationNumber }));
    return (q ? list.filter(o => o.label.toLowerCase().includes(q)) : list).slice(0, 30);
  }, [docEntityType, drivers, vehicles, entitySearch]);

  const pickScan = (fromCamera: boolean) => async () => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission Denied', fromCamera ? 'Camera access required.' : 'Gallery access required.'); return; }
    const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.6 };
    const res = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!res.canceled && res.assets[0]) setDocUri(res.assets[0].uri);
  };

  const saveDocument = async () => {
    if (!docEntityId) { Alert.alert('Required', `Choose a ${docEntityType}.`); return; }
    if (docExpiry.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(docExpiry.trim())) {
      Alert.alert('Invalid date', 'Expiry must be in YYYY-MM-DD format.');
      return;
    }
    setSavingDoc(true);
    try {
      await addDocument({
        entityType: docEntityType,
        entityId: docEntityId,
        docType,
        expiryDate: docExpiry.trim() || undefined,
        localUri: docUri,
        createdBy: user?.uid,
      });
      setDocModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save document.');
    } finally {
      setSavingDoc(false);
    }
  };

  const runJob = async (job: 'rollup' | 'scan') => {
    setRunningJob(job);
    try {
      const n = job === 'rollup' ? await runTripStatsRollup() : await runComplianceScan();
      Alert.alert('Done', job === 'rollup' ? `Re-rolled ${n} day(s) of trip stats.` : `Sent ${n} expiry notification(s) to drivers.`);
      setJobRuns(await getJobRuns().catch(() => jobRuns));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Job failed.');
    } finally {
      setRunningJob(null);
    }
  };

  const jobRun = (name: string) => jobRuns.find(j => j.jobName === name);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backBtnText}>‹</Text>
        </TouchableOpacity>
        <Text style={s.pageTitle}>Fleet Health</Text>
        <TouchableOpacity style={s.addBtn} onPress={openDocModal} activeOpacity={0.85}>
          <Text style={s.addBtnText}>+ Document</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
      >
        <View style={s.chipsRow}>
          {WINDOWS.map(w => (
            <TouchableOpacity key={w} style={[s.chip, withinDays === w && s.chipActive]} onPress={() => setWithinDays(w)} activeOpacity={0.8}>
              <Text style={[s.chipText, withinDays === w && s.chipTextActive]}>Next {w} days</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!loading && !loadError && (
          <View style={s.summaryRow}>
            <View style={[s.summaryBox, { borderLeftColor: Colors.danger }]}>
              <Text style={[s.summaryValue, { color: Colors.danger }]}>{overdueCount}</Text>
              <Text style={s.summaryLabel}>Overdue</Text>
            </View>
            <View style={[s.summaryBox, { borderLeftColor: Colors.warning }]}>
              <Text style={[s.summaryValue, { color: Colors.warning }]}>{alerts.length - overdueCount}</Text>
              <Text style={s.summaryLabel}>Due soon</Text>
            </View>
          </View>
        )}

        {loading ? (
          <ShimmerList count={4} />
        ) : loadError ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>⚠️</Text>
            <Text style={s.emptyText}>Couldn't load fleet health</Text>
            <Text style={s.emptySub}>Pull down to retry. If this persists, the latest database migration may not be applied yet.</Text>
          </View>
        ) : alerts.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>✅</Text>
            <Text style={s.emptyText}>All clear</Text>
            <Text style={s.emptySub}>Nothing expires or falls due in the next {withinDays} days.</Text>
          </View>
        ) : (
          SECTIONS.filter(sec => grouped[sec.kind]?.length).map(sec => (
            <View key={sec.kind} style={s.card}>
              <Text style={s.cardTitle}>{sec.icon}  {sec.title}</Text>
              {grouped[sec.kind].map((a, i) => (
                <View key={`${a.entityId}-${a.item}-${i}`} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{a.label}</Text>
                    <Text style={s.rowSub}>
                      {itemLabel(a.item)}
                      {a.dueDate ? ` · ${fmtDate(a.dueDate)}` : ''}
                      {a.dueOdometer != null ? ` · at ${Math.round(a.dueOdometer)} km (now ${Math.round(a.currentOdometer ?? 0)} km)` : ''}
                    </Text>
                  </View>
                  <DueBadge alert={a} />
                </View>
              ))}
            </View>
          ))
        )}

        {isAdmin && (
          <View style={s.card}>
            <Text style={s.cardTitle}>🩺  System health</Text>
            {[
              { label: 'Trip stats rollup', run: jobRun('trip_stats_rollup'), job: 'rollup' as const },
              { label: 'Expiry reminder scan', run: jobRun('compliance_scan'), job: 'scan' as const },
            ].map(j => (
              <View key={j.job} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{j.label}</Text>
                  <Text style={s.rowSub}>Last run: {fmtDateTime(j.run?.lastRunAt)}</Text>
                </View>
                <TouchableOpacity style={s.runBtn} onPress={() => runJob(j.job)} disabled={!!runningJob} activeOpacity={0.8}>
                  {runningJob === j.job ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={s.runBtnText}>Run now</Text>}
                </TouchableOpacity>
              </View>
            ))}
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>Unsynced offline writes (this device)</Text>
                <Text style={s.rowSub}>Replayed automatically when back online</Text>
              </View>
              <Text style={[s.rowTitle, { color: pendingOffline ? Colors.warning : Colors.success }]}>{pendingOffline}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={docModal} transparent animationType="slide" onRequestClose={() => setDocModal(false)}>
        <KeyboardAvoidingView style={m.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>Add Document</Text>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={m.label}>For</Text>
              <View style={s.chipsRow}>
                {(['vehicle', 'driver'] as DocEntityType[]).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[s.chip, docEntityType === t && s.chipActive]}
                    onPress={() => {
                      setDocEntityType(t);
                      setDocEntityId('');
                      setEntitySearch('');
                      setDocType(DOC_TYPES_BY_ENTITY[t][0]);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.chipText, docEntityType === t && s.chipTextActive]}>{t === 'vehicle' ? '🚛 Vehicle' : '👷 Driver'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={m.input}
                value={entitySearch}
                onChangeText={setEntitySearch}
                placeholder={docEntityType === 'vehicle' ? 'Search registration…' : 'Search driver…'}
                placeholderTextColor={Colors.textMuted}
              />
              <View style={m.optionList}>
                {entityOptions.map(o => (
                  <TouchableOpacity
                    key={o.id}
                    style={[m.option, docEntityId === o.id && m.optionActive]}
                    onPress={() => setDocEntityId(o.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[m.optionText, docEntityId === o.id && m.optionTextActive]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
                {entityOptions.length === 0 && <Text style={s.rowSub}>No matches</Text>}
              </View>

              <Text style={m.label}>Type</Text>
              <View style={[s.chipsRow, { flexWrap: 'wrap' as const }]}>
                {allowedDocTypes.map(t => (
                  <TouchableOpacity key={t} style={[s.chip, docType === t && s.chipActive]} onPress={() => setDocType(t)} activeOpacity={0.8}>
                    <Text style={[s.chipText, docType === t && s.chipTextActive]}>{itemLabel(t)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>Expiry date (optional, YYYY-MM-DD)</Text>
              <TextInput
                style={m.input}
                value={docExpiry}
                onChangeText={setDocExpiry}
                placeholder="2027-03-31"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
              />

              <Text style={m.label}>Scan (optional)</Text>
              <View style={s.chipsRow}>
                <TouchableOpacity style={s.chip} onPress={pickScan(true)} activeOpacity={0.8}>
                  <Text style={s.chipText}>📷 Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.chip} onPress={pickScan(false)} activeOpacity={0.8}>
                  <Text style={s.chipText}>🖼 Gallery</Text>
                </TouchableOpacity>
                {docUri && <Text style={[s.rowSub, { alignSelf: 'center' as const }]}>✓ Attached</Text>}
              </View>

              <View style={m.btns}>
                <TouchableOpacity style={m.cancelBtn} onPress={() => setDocModal(false)} disabled={savingDoc}>
                  <Text style={m.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={m.saveBtn} onPress={saveDocument} disabled={savingDoc} activeOpacity={0.85}>
                  {savingDoc ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.saveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
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
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    gap: Spacing[3],
  },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.surface,
    justifyContent: 'center' as const, alignItems: 'center' as const, ...Shadow.sm,
  },
  backBtnText: { fontSize: 24, color: Colors.text, marginTop: -2 },
  pageTitle: { flex: 1, fontSize: FontSize['2xl'], fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  addBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], borderRadius: Radius.full },
  addBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.sm },
  scroll: { padding: Spacing[4], paddingBottom: Spacing[12] } as const,
  chipsRow: { flexDirection: 'row' as const, gap: Spacing[2], marginBottom: Spacing[3] },
  chip: {
    paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], borderRadius: Radius.full,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing[1],
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' as const },
  chipTextActive: { color: '#fff' },
  summaryRow: { flexDirection: 'row' as const, gap: Spacing[3], marginBottom: Spacing[4] },
  summaryBox: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing[4],
    borderLeftWidth: 4, ...Shadow.sm,
  },
  summaryValue: { fontSize: FontSize['2xl'], fontWeight: '800' as const },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' as const, marginTop: 2 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing[4], marginBottom: Spacing[4], ...Shadow.md },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text, marginBottom: Spacing[2] },
  row: {
    flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: Spacing[3],
    borderTopWidth: 1, borderTopColor: Colors.border, gap: Spacing[3],
  },
  rowTitle: { fontSize: FontSize.base, fontWeight: '600' as const, color: Colors.text },
  rowSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: Spacing[2], paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { fontSize: FontSize.xs, fontWeight: '700' as const },
  runBtn: { paddingHorizontal: Spacing[3], paddingVertical: Spacing[2], borderRadius: Radius.full, backgroundColor: Colors.primaryLight, minWidth: 80, alignItems: 'center' as const },
  runBtnText: { color: Colors.primary, fontWeight: '700' as const, fontSize: FontSize.xs },
  empty: { alignItems: 'center' as const, paddingVertical: Spacing[10], paddingHorizontal: Spacing[6] },
  emptyIcon: { fontSize: 40, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700' as const, color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' as const, marginTop: Spacing[1] },
};

const m = {
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing[5], maxHeight: '90%' as const,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' as const, marginBottom: Spacing[3] },
  title: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[3] },
  label: { fontSize: FontSize.xs, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: Spacing[1], marginTop: Spacing[2] },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[3], fontSize: FontSize.base, color: Colors.text, backgroundColor: Colors.surfaceAlt, marginBottom: Spacing[2],
  },
  optionList: { maxHeight: 180, marginBottom: Spacing[2] },
  option: { paddingVertical: Spacing[2], paddingHorizontal: Spacing[3], borderRadius: Radius.sm },
  optionActive: { backgroundColor: Colors.primaryLight },
  optionText: { fontSize: FontSize.sm, color: Colors.text },
  optionTextActive: { color: Colors.primary, fontWeight: '700' as const },
  btns: { flexDirection: 'row' as const, gap: Spacing[3], marginTop: Spacing[4], marginBottom: Spacing[4] },
  cancelBtn: { flex: 1, paddingVertical: Spacing[3], borderRadius: Radius.md, alignItems: 'center' as const, backgroundColor: Colors.surfaceAlt },
  cancelText: { fontWeight: '600' as const, color: Colors.textSecondary },
  saveBtn: { flex: 1, paddingVertical: Spacing[3], borderRadius: Radius.md, alignItems: 'center' as const, backgroundColor: Colors.primary },
  saveText: { fontWeight: '700' as const, color: '#fff' },
};
