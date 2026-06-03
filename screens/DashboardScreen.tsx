import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Animated,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { getTrips, getTripsByUser, TripFirestore } from '../services/tripService';
import { getDrivers } from '../services/driverService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole, TabId } from './MainTabsScreen';

interface Props {
  role: UserRole;
  onTabPress: (tab: TabId) => void;
}

const SkeletonBox = ({ width, height, style }: { width: any; height: number; style?: any }) => {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: Radius.sm, backgroundColor: Colors.border, opacity: anim },
        style,
      ]}
    />
  );
};

const formatDT = (d: Date | null) => {
  if (!d) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const startOfWeek = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() - n.getDay()); n.setHours(0, 0, 0, 0); return n; };

export default function DashboardScreen({ role, onTabPress }: Props) {
  const user = auth.currentUser;
  const [trips, setTrips] = useState<(TripFirestore & { id: string })[]>([]);
  const [driverCount, setDriverCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [fetchedTrips, drivers] = await Promise.all([
        role === 'driver' ? getTripsByUser(user?.uid ?? '') : getTrips(),
        role !== 'driver' ? getDrivers() : Promise.resolve([]),
      ]);
      setTrips(fetchedTrips);
      if (role !== 'driver') setDriverCount(drivers.length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  const now = new Date();
  const todayTrips = trips.filter(t => t.departureTime && t.departureTime >= startOfDay(now));
  const activeTrips = trips.filter(t => !t.arrivalTime);
  const weekTrips = trips.filter(t => t.departureTime && t.departureTime >= startOfWeek(now));
  const totalFuelWeek = weekTrips.reduce((sum, t) => sum + (parseFloat(t.fuelFilled) || 0), 0);
  const recentTrips = trips.slice(0, 8);

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

        {/* Stats Grid */}
        <Text style={s.sectionTitle}>Overview</Text>
        {loading ? (
          <View style={s.statsGrid}>
            {[0,1,2,3].map(i => (
              <View key={i} style={s.statCard}>
                <SkeletonBox width={48} height={36} style={{ marginBottom: 8 }} />
                <SkeletonBox width="70%" height={12} />
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
                <SkeletonBox width={36} height={36} style={{ borderRadius: Radius.full, marginRight: 12 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <SkeletonBox width="60%" height={13} />
                  <SkeletonBox width="80%" height={11} />
                  <SkeletonBox width="50%" height={11} />
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
