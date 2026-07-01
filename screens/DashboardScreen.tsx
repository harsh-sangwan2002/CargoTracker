import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { auth } from '../supabaseConfig';
import { getTrips, getTripsByUser, subscribeToDriverTrips, TripRecord } from '../services/tripService';
import { getDrivers, Driver } from '../services/driverService';
import { getVehicles, Vehicle } from '../services/vehicleService';
import { getUpcomingMaintenance, VehicleMaintenance } from '../services/vehicleMaintenanceService';
import { updateDriverLocation, clearDriverTracking } from '../services/locationService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerBox } from '../components/Shimmer';
import type { UserRole, TabId } from './MainTabsScreen';

interface Props {
  role: UserRole;
  onTabPress: (tab: TabId) => void;
}

const formatDT = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const startOfWeek = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() - n.getDay()); n.setHours(0, 0, 0, 0); return n; };

export default function DashboardScreen({ role, onTabPress }: Props) {
  const user = auth.currentUser;
  const [trips, setTrips] = useState<(TripRecord & { id: string })[]>([]);
  const [driverCount, setDriverCount] = useState(0);
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);
  const [vehicles, setVehicles] = useState<(Vehicle & { id: string })[]>([]);
  const [upcomingMaintenance, setUpcomingMaintenance] = useState<(VehicleMaintenance & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);

  // Stop tracking on unmount
  useEffect(() => {
    return () => {
      if (locationWatcher.current) locationWatcher.current.remove();
      if (user && role === 'driver') clearDriverTracking(user.uid).catch(() => {});
    };
  }, []);

  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required to share your position.');
      return;
    }
    const activeTrip = trips.find(t => !t.arrivalTime);
    locationWatcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
      (pos) => {
        if (!user) return;
        updateDriverLocation(user.uid, {
          driverName: user.displayName || user.email || 'Driver',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          updatedAt: Date.now(),
          isTracking: true,
          tripRoute: activeTrip ? `${activeTrip.fromPlant || '?'} → ${activeTrip.toPlant || '?'}` : undefined,
        }).catch(() => {});
      }
    );
    setIsTracking(true);
  };

  const stopTracking = () => {
    if (locationWatcher.current) { locationWatcher.current.remove(); locationWatcher.current = null; }
    if (user) clearDriverTracking(user.uid).catch(() => {});
    setIsTracking(false);
  };

  const load = async () => {
    try {
      const [fetchedTrips, fetchedDrivers, fetchedVehicles, fetchedMaintenance] = await Promise.all([
        role === 'driver' ? getTripsByUser(user?.uid ?? '') : getTrips(),
        role !== 'driver' ? getDrivers() : Promise.resolve([]),
        role !== 'driver' ? getVehicles() : Promise.resolve([]),
        role !== 'driver' ? getUpcomingMaintenance(30).catch(() => []) : Promise.resolve([]),
      ]);
      setTrips(fetchedTrips);
      if (role !== 'driver') {
        setDriverCount(fetchedDrivers.length);
        setDrivers(fetchedDrivers);
        setVehicles(fetchedVehicles);
        setUpcomingMaintenance(fetchedMaintenance);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    if (role === 'driver' && user?.uid) {
      const unsub = subscribeToDriverTrips(user.uid, setTrips);
      return unsub;
    }
  }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  const now = new Date();
  const todayTrips = trips.filter(t => t.departureTime && t.departureTime >= startOfDay(now));
  const activeTrips = trips.filter(t => !t.arrivalTime);
  const weekTrips = trips.filter(t => t.departureTime && t.departureTime >= startOfWeek(now));
  const totalFuelWeek = weekTrips.reduce((sum, t) => sum + (parseFloat(t.fuelFilled) || 0), 0);
  const recentTrips = trips.slice(0, 8);

  // Compliance alerts: licenses/insurance/permit/PUC expiring within 30 days (or already expired)
  const daysUntil = (dateStr?: string) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };
  const vehicleRegById = Object.fromEntries(vehicles.map(v => [v.id, v.registrationNumber]));
  const expiringDocs = role !== 'driver'
    ? [
        ...drivers
          .map(d => ({ label: `${d.fullName} · License`, days: daysUntil(d.licenseExpiry) }))
          .filter((x): x is { label: string; days: number } => x.days !== null && x.days <= 30),
        ...vehicles.flatMap(v => [
          { label: `${v.registrationNumber} · Insurance`, days: daysUntil(v.insuranceExpiry) },
          { label: `${v.registrationNumber} · Permit`, days: daysUntil(v.permitExpiry) },
          { label: `${v.registrationNumber} · PUC`, days: daysUntil(v.pucExpiry) },
        ]).filter((x): x is { label: string; days: number } => x.days !== null && x.days <= 30),
        ...upcomingMaintenance
          .map(m => ({
            label: `${vehicleRegById[m.vehicleId] ?? 'Vehicle'} · ${m.maintenanceType} due`,
            days: daysUntil(m.nextServiceDueDate),
          }))
          .filter((x): x is { label: string; days: number } => x.days !== null && x.days <= 30),
      ].sort((a, b) => a.days - b.days)
    : [];

  const roleLabel = role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Driver';
  const roleColor = role === 'admin' ? Colors.roleAdmin : role === 'manager' ? Colors.roleManager : Colors.roleDriver;
  const roleLight = role === 'admin' ? Colors.roleAdminLight : role === 'manager' ? Colors.roleManagerLight : Colors.roleDriverLight;

  const stats = role === 'driver'
    ? [
        { label: "Today's Trips", value: todayTrips.length, color: Colors.primary },
        { label: 'This Week', value: weekTrips.length, color: Colors.success },
        { label: 'Total Trips', value: trips.length, color: Colors.warning },
        { label: 'Active Now', value: activeTrips.length, color: Colors.danger },
      ]
    : [
        { label: 'Total Trips', value: trips.length, color: Colors.primary },
        { label: 'Active Now', value: activeTrips.length, color: Colors.danger },
        { label: 'Drivers', value: driverCount, color: Colors.success },
        { label: 'Fuel (L) Week', value: Math.round(totalFuelWeek), color: Colors.warning },
      ];

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Good {now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'}</Text>
            <Text style={s.email} numberOfLines={1}>{user?.email}</Text>
          </View>
          <View style={[s.roleBadge, { backgroundColor: roleLight }]}>
            <Text style={[s.roleText, { color: roleColor }]}>{roleLabel}</Text>
          </View>
        </View>

        {/* Quick Actions (Manager/Admin) */}
        {role !== 'driver' && (
          <View style={s.quickActions}>
            <Text style={s.sectionTitle}>Quick Actions</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: Spacing[2] }}>
              {[
                { label: 'Add Trip', icon: '➕', tab: 'trips' as TabId },
                { label: 'Reports', icon: '📊', tab: 'analytics' as TabId },
                { label: 'Manage', icon: '⚙️', tab: 'manage' as TabId },
              ].map(item => (
                <TouchableOpacity
                  key={item.tab}
                  style={s.quickBtn}
                  onPress={() => onTabPress(item.tab)}
                  activeOpacity={0.8}
                >
                  <Text style={s.quickBtnIcon}>{item.icon}</Text>
                  <Text style={s.quickBtnLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Driver: Active Trip Card */}
        {role === 'driver' && (() => {
          const activeTrip = trips.find(t => !t.arrivalTime);
          if (!activeTrip) return null;
          return (
            <View style={s.activeTripCard}>
              <View style={s.activeTripHeader}>
                <View style={s.activeDot} />
                <Text style={s.activeTripLabel}>Active Trip</Text>
                <View style={[s.statusChip, { backgroundColor: Colors.successLight }]}>
                  <Text style={[s.statusText, { color: Colors.success }]}>En Route</Text>
                </View>
              </View>
              <Text style={s.activeTripRoute}>{activeTrip.fromPlant || '—'}  →  {activeTrip.toPlant || '—'}</Text>
              <View style={s.activeTripMeta}>
                <Text style={s.metaText}>🚛  {activeTrip.truck}</Text>
                <Text style={s.metaText}>⛽  {activeTrip.fuelFilled || '—'} L</Text>
              </View>
            </View>
          );
        })()}

        {/* Driver: GPS Tracking Card */}
        {role === 'driver' && (
          <View style={s.trackCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.trackTitle}>Live GPS Tracking</Text>
              <Text style={s.trackSub}>
                {isTracking ? '📡  Sharing your location with admin' : 'Share your location when on a trip'}
              </Text>
            </View>
            <Switch
              value={isTracking}
              onValueChange={v => v ? startTracking() : stopTracking()}
              trackColor={{ false: Colors.border, true: Colors.primary + '66' }}
              thumbColor={isTracking ? Colors.primary : Colors.textMuted}
            />
          </View>
        )}

        {/* Stats Grid */}
        <Text style={s.sectionTitle}>Overview</Text>
        {loading ? (
          <View style={s.statsGrid}>
            {[0,1,2,3].map(i => (
              <View key={i} style={s.statCard}>
                <ShimmerBox width={48} height={36} style={{ marginBottom: 8 }} />
                <ShimmerBox width="70%" height={12} />
              </View>
            ))}
          </View>
        ) : (
          <View style={s.statsGrid}>
            {stats.map((st, i) => (
              <View key={i} style={s.statCard}>
                <Text style={[s.statValue, { color: st.color }]}>{st.value}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Compliance Alerts (Manager/Admin) */}
        {role !== 'driver' && expiringDocs.length > 0 && (
          <View style={s.alertsCard}>
            <Text style={s.alertsTitle}>⚠ Documents Expiring Soon</Text>
            {expiringDocs.slice(0, 6).map((doc, i) => (
              <View key={i} style={[s.alertRow, i === Math.min(expiringDocs.length, 6) - 1 && { borderBottomWidth: 0 }]}>
                <Text style={s.alertLabel}>{doc.label}</Text>
                <Text style={[s.alertDays, doc.days < 0 && { color: Colors.danger }]}>
                  {doc.days < 0 ? `Expired ${Math.abs(doc.days)}d ago` : doc.days === 0 ? 'Expires today' : `${doc.days}d left`}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Recent Trips */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Recent Trips</Text>
          <TouchableOpacity onPress={() => onTabPress('trips')} activeOpacity={0.7}>
            <Text style={s.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        <View style={s.tripList}>
          {loading ? (
            [0,1,2,3].map(i => (
              <View key={i} style={s.tripSkeleton}>
                <ShimmerBox width={36} height={36} style={{ borderRadius: Radius.full, marginRight: 12 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <ShimmerBox width="60%" height={13} />
                  <ShimmerBox width="80%" height={11} />
                  <ShimmerBox width="50%" height={11} />
                </View>
              </View>
            ))
          ) : recentTrips.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🚛</Text>
              <Text style={s.emptyText}>No trips yet</Text>
              <Text style={s.emptySubText}>
                {role === 'driver' ? 'Your assigned trips will appear here.' : 'Add a trip to get started.'}
              </Text>
            </View>
          ) : (
            recentTrips.map(trip => {
              const delivered = !!trip.arrivalTime;
              return (
                <View key={trip.id} style={s.tripRow}>
                  <View style={[s.tripDot, { backgroundColor: delivered ? Colors.success : Colors.primary }]} />
                  <View style={s.tripContent}>
                    <View style={s.tripTopRow}>
                      <Text style={s.tripVehicle}>{trip.truck}</Text>
                      <View style={[s.statusChip, { backgroundColor: delivered ? Colors.successLight : Colors.primaryLight }]}>
                        <Text style={[s.statusText, { color: delivered ? Colors.success : Colors.primary }]}>
                          {delivered ? 'Delivered' : 'Active'}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.tripRoute}>
                      {trip.fromPlant || '—'} → {trip.toPlant || '—'}
                    </Text>
                    {trip.driverName ? (
                      <Text style={s.tripMeta}>Driver: {trip.driverName}</Text>
                    ) : null}
                    <Text style={s.tripTime}>{formatDT(trip.departureTime)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { padding: Spacing[5], paddingBottom: Spacing[10] } as const,

  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[5],
  },
  greeting: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' as const },
  email: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text, maxWidth: 220 },
  roleBadge: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  roleText: { fontSize: FontSize.xs, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const },

  activeTripCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[4],
    borderLeftWidth: 4,
    borderLeftColor: Colors.success,
    ...Shadow.md,
  },
  activeTripHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: Spacing[2] },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success, marginRight: Spacing[2] },
  activeTripLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.success, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  activeTripRoute: { fontSize: FontSize.lg, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[3], letterSpacing: -0.3 },
  activeTripMeta: { flexDirection: 'row' as const, gap: Spacing[4] },
  metaText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' as const },

  trackCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[5],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    ...Shadow.sm,
  },
  trackTitle: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text, marginBottom: 3 },
  trackSub: { fontSize: FontSize.xs, color: Colors.textSecondary },

  quickActions: { marginBottom: Spacing[5] } as const,
  quickBtn: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    marginRight: Spacing[3],
    alignItems: 'center' as const,
    minWidth: 90,
    ...Shadow.sm,
  },
  quickBtnIcon: { fontSize: 22, marginBottom: 4 },
  quickBtnLabel: { fontSize: FontSize.xs, fontWeight: '600' as const, color: Colors.textSecondary },

  sectionHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[3],
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text, marginBottom: Spacing[3] },
  seeAll: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' as const },

  statsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: Spacing[3],
    marginBottom: Spacing[6],
  },
  statCard: {
    backgroundColor: Colors.surface,
    width: '47.5%' as const,
    padding: Spacing[4],
    borderRadius: Radius.lg,
    ...Shadow.md,
  },
  statValue: { fontSize: FontSize['3xl'], fontWeight: '800' as const, letterSpacing: -1 },
  statLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing[1], fontWeight: '500' as const },

  alertsCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[5],
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
    ...Shadow.md,
  },
  alertsTitle: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text, marginBottom: Spacing[2] },
  alertRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  alertLabel: { fontSize: FontSize.sm, color: Colors.text, flex: 1 },
  alertDays: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700' as const },

  tripList: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing[2],
    ...Shadow.md,
    marginBottom: Spacing[4],
  },
  tripSkeleton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    padding: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
    marginTop: 5,
    marginRight: Spacing[3],
  },
  tripContent: { flex: 1 } as const,
  tripTopRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 4,
  },
  tripVehicle: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text },
  statusChip: {
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' as const },
  tripRoute: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' as const, marginBottom: 2 },
  tripMeta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: 2 },
  tripTime: { fontSize: FontSize.xs, color: Colors.textMuted },

  empty: {
    alignItems: 'center' as const,
    paddingVertical: Spacing[10],
  },
  emptyIcon: { fontSize: 40, marginBottom: Spacing[2] },
  emptyText: { fontSize: FontSize.md, fontWeight: '600' as const, color: Colors.textSecondary },
  emptySubText: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const },
};
