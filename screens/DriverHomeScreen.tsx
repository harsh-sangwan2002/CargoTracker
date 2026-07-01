import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, Switch, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { auth } from '../supabaseConfig';
import { getTripsByUser, subscribeToDriverTrips, startTrip, endTrip, TripRecord } from '../services/tripService';
import { registerOfflineHandler, enqueueOfflineOp } from '../utils/offlineQueue';
import { updateDriverLocation, clearDriverTracking } from '../services/locationService';
import { getDriverNotifications, subscribeToDriverNotifications, markAllNotificationsRead, AppNotification } from '../services/notificationService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import { ShimmerStatsRow, ShimmerList } from '../components/Shimmer';
import type { TabId } from './MainTabsScreen';

interface Props {
  onTabPress: (tab: TabId) => void;
  onNavigateToTrip: (tripId: string) => void;
}

type Trip = TripRecord & { id: string };

export default function DriverHomeScreen({ onTabPress, onNavigateToTrip }: Props) {
  const user = auth.currentUser;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [dismissingNotifs, setDismissingNotifs] = useState(false);

  const loadNotifications = async () => {
    if (!user?.uid) return;
    const notifs = await getDriverNotifications(user.uid);
    setNotifications(notifs);
  };

  const load = async () => {
    try {
      const data = await getTripsByUser(user?.uid ?? '');
      setTrips(data);
      // Auto-resume GPS if driver has an active trip and isn't already tracking
      const running = data.find(t => t.status === 'active' && !t.arrivalTime);
      if (running && !locationWatcher.current) {
        await startGPS(running);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    registerOfflineHandler('startTrip', async (payload) => { await startTrip(payload.tripId); });
    registerOfflineHandler('endTrip', async (payload) => { await endTrip(payload.tripId); });
  }, []);

  useEffect(() => {
    load();
    loadNotifications();

    const unsubTrips = user?.uid ? subscribeToDriverTrips(user.uid, setTrips) : undefined;
    const unsubNotifs = user?.uid ? subscribeToDriverNotifications(user.uid, setNotifications) : undefined;

    return () => {
      unsubTrips?.();
      unsubNotifs?.();
      locationWatcher.current?.remove();
      if (user) clearDriverTracking(user.uid).catch(() => {});
    };
  }, []);

  const unreadNotifs = notifications.filter(n => !n.read);

  const handleDismissAll = async () => {
    if (!user?.uid) return;
    setDismissingNotifs(true);
    try {
      await markAllNotificationsRead(user.uid);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
    setDismissingNotifs(false);
  };

  const startGPS = async (activeTrip?: Trip) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location access is required to share your live position.');
      return;
    }
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
          tripRoute: activeTrip
            ? `${activeTrip.fromPlant || '?'} → ${activeTrip.toPlant || '?'}`
            : undefined,
        }).catch(() => {});
      }
    );
    setIsTracking(true);
  };

  const stopGPS = () => {
    locationWatcher.current?.remove();
    locationWatcher.current = null;
    if (user) clearDriverTracking(user.uid).catch(() => {});
    setIsTracking(false);
  };

  const handleStartTrip = async (trip: Trip) => {
    Alert.alert(
      'Start Trip',
      `Start trip from ${trip.fromPlant} → ${trip.toPlant}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            setActionLoading(trip.id);
            try {
              const net = await NetInfo.fetch();
              const online = net.isConnected && net.isInternetReachable !== false;
              if (!online) {
                await enqueueOfflineOp('startTrip', { tripId: trip.id });
                setTrips(prev => prev.map(t => (t.id === trip.id ? { ...t, status: 'active' } : t)));
                Alert.alert('Offline', 'No connection — this will sync automatically once you\'re back online.');
              } else {
                await startTrip(trip.id);
                await load();
              }
              // Auto-start GPS when trip begins (works offline too — location is queued server-side)
              const updated = { ...trip, departureTime: new Date() };
              await startGPS(updated);
            } catch {
              Alert.alert('Error', 'Could not start trip. Try again.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleEndTrip = async (trip: Trip) => {
    Alert.alert(
      'End Trip',
      `Mark trip from ${trip.fromPlant} → ${trip.toPlant} as completed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Trip',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(trip.id);
            try {
              const net = await NetInfo.fetch();
              const online = net.isConnected && net.isInternetReachable !== false;
              if (!online) {
                await enqueueOfflineOp('endTrip', { tripId: trip.id });
                setTrips(prev => prev.map(t => (t.id === trip.id ? { ...t, arrivalTime: new Date() } : t)));
                stopGPS();
                Alert.alert('Offline', 'No connection — this will sync automatically once you\'re back online.');
              } else {
                await endTrip(trip.id);
                stopGPS();
                await load();
              }
            } catch {
              Alert.alert('Error', 'Could not end trip. Try again.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const HOME_LIMIT = 7;
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  // activeTrip = trip the driver has pressed "Start" on (status set to 'active' by startTrip())
  const activeTrip = trips.find(t => t.status === 'active' && !t.arrivalTime);
  // recentTrips = last 7 (already sorted desc by createdAt)
  const recentTrips = trips.slice(0, HOME_LIMIT);
  const todayCount = trips.filter(t => t.departureTime && t.departureTime >= todayStart).length;
  const completedCount = trips.filter(t => !!t.arrivalTime).length;

  const getTripStatus = (t: Trip): 'pending' | 'in-progress' | 'completed' => {
    if (!!t.arrivalTime) return 'completed';
    if (t.status === 'active') return 'in-progress';
    return 'pending';
  };

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.greeting}>{greeting}</Text>
            <Text style={s.email} numberOfLines={1}>{user?.email}</Text>
          </View>
          <View style={s.driverBadge}>
            <Text style={s.driverBadgeText}>DRIVER</Text>
          </View>
        </View>

        {/* Notifications */}
        {unreadNotifs.length > 0 && (
          <View style={s.notifSection}>
            <View style={s.notifHeader}>
              <Text style={s.notifHeaderText}>🔔  {unreadNotifs.length} New Assignment{unreadNotifs.length > 1 ? 's' : ''}</Text>
              <TouchableOpacity onPress={handleDismissAll} disabled={dismissingNotifs} activeOpacity={0.7}>
                <Text style={s.notifDismissAll}>Dismiss all</Text>
              </TouchableOpacity>
            </View>
            {unreadNotifs.map(n => (
              <View key={n.id} style={s.notifCard}>
                <Text style={s.notifTitle}>{n.title}</Text>
                <Text style={s.notifBody}>{n.body}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Stats Row */}
        {!loading && (
          <View style={s.statsRow}>
            {[
              { label: "Today's Trips", value: todayCount, color: Colors.primary },
              { label: 'Completed', value: completedCount, color: Colors.success },
              { label: 'Total', value: trips.length, color: Colors.warning },
            ].map((st, i) => (
              <View key={i} style={s.statBox}>
                <Text style={[s.statVal, { color: st.color }]}>{st.value}</Text>
                <Text style={s.statLbl}>{st.label}</Text>
              </View>
            ))}
          </View>
        )}

        {loading && <ShimmerStatsRow />}

        {/* Active Trip */}
        {activeTrip && (
          <View style={s.activeTripCard}>
            <View style={s.activeTripTop}>
              <View style={s.activePulse} />
              <Text style={s.activeTripLabel}>Active Trip</Text>
              <View style={s.enRouteBadge}>
                <Text style={s.enRouteText}>En Route</Text>
              </View>
            </View>

            <Text style={s.activeTripRoute}>
              {activeTrip.fromPlant || '—'}  →  {activeTrip.toPlant || '—'}
            </Text>

            <View style={s.activeTripMeta}>
              <MetaItem icon="🚛" label={activeTrip.truck} />
              {activeTrip.fuelFilled ? <MetaItem icon="⛽" label={`${activeTrip.fuelFilled} L`} /> : null}
              {activeTrip.quantity ? <MetaItem icon="📦" label={activeTrip.quantity} /> : null}
            </View>

            {/* GPS Toggle */}
            <View style={s.gpsRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.gpsTitle}>
                  {isTracking ? '📡  Broadcasting location' : '📍  Share live location'}
                </Text>
                <Text style={s.gpsSub}>
                  {isTracking ? 'Admin can see you on the map' : 'Toggle to share with admin'}
                </Text>
              </View>
              <Switch
                value={isTracking}
                onValueChange={v => v ? startGPS(activeTrip) : stopGPS()}
                trackColor={{ false: Colors.border, true: Colors.primary + '55' }}
                thumbColor={isTracking ? Colors.primary : Colors.textMuted}
              />
            </View>

            {/* End Trip */}
            <TouchableOpacity
              style={s.endTripBtn}
              onPress={() => handleEndTrip(activeTrip)}
              activeOpacity={0.85}
              disabled={actionLoading === activeTrip.id}
            >
              {actionLoading === activeTrip.id
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.endTripBtnText}>End Trip</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Recent Trips */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Recent Trips</Text>
          <TouchableOpacity onPress={() => onTabPress('trips')} activeOpacity={0.7}>
            <Text style={s.seeAll}>See all →</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ShimmerList count={3} />
        ) : trips.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyIcon}>🚛</Text>
            <Text style={s.emptyTitle}>No trips assigned yet</Text>
            <Text style={s.emptySub}>Your manager will assign trips to you. Pull down to refresh.</Text>
          </View>
        ) : (
          recentTrips.map(trip => {
            const status = getTripStatus(trip);
            return (
              <TouchableOpacity key={trip.id} style={s.pendingCard} onPress={() => onNavigateToTrip(trip.id)} activeOpacity={0.85}>
                <View style={s.pendingCardTop}>
                  <Text style={s.pendingRoute} numberOfLines={1}>
                    {trip.fromPlant || '—'}  →  {trip.toPlant || '—'}
                  </Text>
                  {status === 'pending' && (
                    <TouchableOpacity
                      style={[s.startBtn, (!!actionLoading || !!activeTrip) && { opacity: 0.5 }]}
                      onPress={() => handleStartTrip(trip)}
                      activeOpacity={0.85}
                      disabled={!!actionLoading || !!activeTrip}
                    >
                      {actionLoading === trip.id
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.startBtnText}>Start</Text>
                      }
                    </TouchableOpacity>
                  )}
                  {status === 'in-progress' && (
                    <View style={[s.statusBadge, { backgroundColor: Colors.primaryLight }]}>
                      <Text style={[s.statusBadgeText, { color: Colors.primary }]}>In Progress</Text>
                    </View>
                  )}
                  {status === 'completed' && (
                    <View style={[s.statusBadge, { backgroundColor: Colors.successLight }]}>
                      <Text style={[s.statusBadgeText, { color: Colors.success }]}>Completed</Text>
                    </View>
                  )}
                </View>
                <View style={s.pendingMeta}>
                  <MetaItem icon="🚛" label={trip.truck} />
                  {trip.itemType ? <MetaItem icon="📦" label={trip.itemType} /> : null}
                  {trip.quantity ? <MetaItem icon="⚖️" label={trip.quantity} /> : null}
                </View>
                {status === 'pending' && activeTrip && (
                  <Text style={s.pendingDisabledNote}>Finish active trip before starting another</Text>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const MetaItem = ({ icon, label }: { icon: string; label: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
    <Text style={{ fontSize: 12 }}>{icon}</Text>
    <Text style={{ fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '500' }}>{label}</Text>
  </View>
);

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { padding: Spacing[5], paddingBottom: Spacing[12] } as const,

  notifSection: { marginBottom: Spacing[4] } as const,
  notifHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[2],
  },
  notifHeaderText: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.warning },
  notifDismissAll: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' as const },
  notifCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[2],
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
    ...Shadow.sm,
  },
  notifTitle: { fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  notifBody: { fontSize: FontSize.xs, color: Colors.textSecondary },

  header: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: Spacing[5] },
  greeting: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' as const },
  email: { fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text, marginTop: 2 },
  driverBadge: { backgroundColor: Colors.roleDriverLight, paddingHorizontal: Spacing[3], paddingVertical: 6, borderRadius: Radius.full },
  driverBadgeText: { fontSize: FontSize.xs, fontWeight: '700' as const, color: Colors.roleDriver, letterSpacing: 0.5 },

  statsRow: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    marginBottom: Spacing[5],
    ...Shadow.sm,
  },
  statBox: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: Spacing[4],
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  statVal: { fontSize: FontSize['2xl'], fontWeight: '800' as const, letterSpacing: -0.5 },
  statLbl: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2, fontWeight: '500' as const },

  activeTripCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    marginBottom: Spacing[5],
    borderLeftWidth: 4,
    borderLeftColor: Colors.success,
    ...Shadow.lg,
  },
  activeTripTop: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: Spacing[3] },
  activePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success, marginRight: Spacing[2] },
  activeTripLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.success, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  enRouteBadge: { backgroundColor: Colors.successLight, paddingHorizontal: Spacing[3], paddingVertical: 3, borderRadius: Radius.full },
  enRouteText: { fontSize: FontSize.xs, fontWeight: '700' as const, color: Colors.success },

  activeTripRoute: { fontSize: FontSize.xl, fontWeight: '800' as const, color: Colors.text, marginBottom: Spacing[3], letterSpacing: -0.3 },
  activeTripMeta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Spacing[4], marginBottom: Spacing[4] },

  gpsRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing[3],
    marginBottom: Spacing[4],
  },
  gpsTitle: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  gpsSub: { fontSize: FontSize.xs, color: Colors.textMuted },

  endTripBtn: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing[4],
    alignItems: 'center' as const,
  },
  endTripBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.base },

  sectionHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: Spacing[3] },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text },
  seeAll: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' as const },

  pendingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    marginBottom: Spacing[3],
    ...Shadow.sm,
  },
  pendingCardTop: { flexDirection: 'row' as const, alignItems: 'center' as const, marginBottom: Spacing[3] },
  pendingRoute: { flex: 1, fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text },
  startBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    minWidth: 64,
    alignItems: 'center' as const,
  },
  startBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.sm },
  statusBadge: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderRadius: Radius.full,
  },
  statusBadgeText: { fontSize: FontSize.xs, fontWeight: '700' as const },
  pendingMeta: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Spacing[4] },
  pendingDisabledNote: { marginTop: Spacing[2], fontSize: FontSize.xs, color: Colors.warning, fontWeight: '500' as const },

  emptyState: { alignItems: 'center' as const, paddingVertical: Spacing[10] },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700' as const, color: Colors.textSecondary, marginBottom: Spacing[1] },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' as const },
};
