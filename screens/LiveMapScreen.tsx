import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { subscribeToActiveLocations, DriverLocation } from '../services/locationService';
import { getDrivers, Driver } from '../services/driverService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';

interface DriverItem {
  id: string;
  userId: string;
  fullName: string;
  vehicleOwned: string;
  location: DriverLocation | null;
}

export default function LiveMapScreen() {
  const navigation = useNavigation();
  const mapRef = useRef<MapView>(null);

  const [allDrivers, setAllDrivers] = useState<(Driver & { id: string })[]>([]);
  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offlineToast, setOfflineToast] = useState(false);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getDrivers()
      .then(all => { setAllDrivers(all); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const unsub = subscribeToActiveLocations(setLocations);
    return unsub;
  }, []);

  useEffect(() => {
    return () => { if (offlineTimer.current) clearTimeout(offlineTimer.current); };
  }, []);

  const driverItems: DriverItem[] = allDrivers.map(d => ({
    id: d.id,
    userId: d.userId,
    fullName: d.fullName || 'Unknown Driver',
    vehicleOwned: d.vehicleOwned || '—',
    location: locations.find(l => l.userId === d.userId) ?? null,
  }));

  const selectedDriver = selectedId ? driverItems.find(d => d.id === selectedId) ?? null : null;

  const visibleMarkers = selectedDriver
    ? (selectedDriver.location ? [selectedDriver.location] : [])
    : driverItems.filter(d => d.location !== null).map(d => d.location!);

  const activeCount = driverItems.filter(d => d.location !== null).length;

  const initialRegion = visibleMarkers.length > 0
    ? { latitude: visibleMarkers[0].lat, longitude: visibleMarkers[0].lng, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 12, longitudeDelta: 12 };

  const handleSelect = (driver: DriverItem) => {
    if (selectedId === driver.id) {
      setSelectedId(null);
      setOfflineToast(false);
      return;
    }
    setSelectedId(driver.id);
    setOfflineToast(false);
    if (offlineTimer.current) clearTimeout(offlineTimer.current);

    if (driver.location) {
      mapRef.current?.animateToRegion({
        latitude: driver.location.lat,
        longitude: driver.location.lng,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }, 700);
    } else {
      setOfflineToast(true);
      offlineTimer.current = setTimeout(() => setOfflineToast(false), 3000);
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Live Driver Map</Text>
        <View style={s.activeBadge}>
          <View style={[s.activeDot, { backgroundColor: activeCount > 0 ? Colors.success : Colors.textMuted }]} />
          <Text style={s.activeText}>{activeCount} active</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.centerBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.loadingText}>Loading drivers…</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Map */}
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={initialRegion}
            showsUserLocation
            showsCompass
          >
            {visibleMarkers.map(loc => (
              <Marker
                key={loc.userId}
                coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                pinColor={Colors.primary}
              >
                <Callout tooltip={false}>
                  <View style={s.callout}>
                    <Text style={s.calloutName}>🚛  {loc.driverName}</Text>
                    {loc.tripRoute ? (
                      <Text style={s.calloutRoute}>{loc.tripRoute}</Text>
                    ) : null}
                    <Text style={s.calloutTime}>
                      {new Date(loc.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </Callout>
              </Marker>
            ))}
          </MapView>

          {/* Offline toast */}
          {offlineToast && (
            <View style={s.toast}>
              <Text style={s.toastText}>Driver is not currently sharing location</Text>
            </View>
          )}

          {/* Driver list panel */}
          <View style={s.panel}>
            {/* Handle */}
            <View style={s.handleRow}>
              <View style={s.handle} />
            </View>

            {/* Panel header */}
            <View style={s.panelHeader}>
              <Text style={s.panelTitle}>Drivers ({driverItems.length})</Text>
              {selectedDriver && (
                <TouchableOpacity onPress={() => { setSelectedId(null); setOfflineToast(false); }}>
                  <Text style={s.showAll}>Show all</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* List */}
            <FlatList
              data={driverItems}
              keyExtractor={d => d.id}
              style={{ paddingHorizontal: Spacing[3] }}
              contentContainerStyle={{ paddingBottom: Spacing[5] }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isLive = item.location !== null;
                const isSel = selectedId === item.id;
                return (
                  <TouchableOpacity
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.75}
                    style={[s.driverRow, isSel && s.driverRowSelected]}
                  >
                    {/* Avatar */}
                    <View style={[s.avatar, { backgroundColor: isLive ? Colors.primary : Colors.disabled }]}>
                      <Text style={s.avatarText}>{getInitials(item.fullName)}</Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={s.driverName}>{item.fullName}</Text>
                      <Text style={s.vehicleNo}>🚛 {item.vehicleOwned}</Text>
                      {item.location?.tripRoute ? (
                        <Text style={s.tripRoute} numberOfLines={1}>{item.location.tripRoute}</Text>
                      ) : null}
                    </View>

                    {/* Status */}
                    <View style={s.statusCol}>
                      <View style={[s.statusChip, { backgroundColor: isLive ? Colors.successLight : Colors.border }]}>
                        <View style={[s.statusDot, { backgroundColor: isLive ? Colors.success : Colors.textMuted }]} />
                        <Text style={[s.statusLabel, { color: isLive ? Colors.success : Colors.textMuted }]}>
                          {isLive ? 'LIVE' : 'OFFLINE'}
                        </Text>
                      </View>
                      {item.location ? (
                        <Text style={s.lastSeen}>
                          {new Date(item.location.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={s.emptyBox}>
                  <Text style={s.emptyIcon}>🚛</Text>
                  <Text style={s.emptyText}>No drivers registered</Text>
                </View>
              }
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = {
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: Spacing[4],
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { marginRight: Spacing[3], padding: 4 },
  backArrow: { fontSize: 22, color: Colors.text },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700' as const, color: Colors.text, flex: 1 },
  activeBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  activeText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  centerBox: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const },
  loadingText: { marginTop: 12, color: Colors.textSecondary },

  callout: { padding: 8, minWidth: 160 },
  calloutName: { fontWeight: '700' as const, fontSize: FontSize.sm, color: Colors.text },
  calloutRoute: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 3 },
  calloutTime: { color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 3 },

  toast: {
    position: 'absolute' as const,
    top: 16,
    alignSelf: 'center' as const,
    backgroundColor: Colors.text,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing[4],
    ...Shadow.md,
  },
  toastText: { color: Colors.surface, fontSize: FontSize.sm },

  panel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: 330,
    ...Shadow.lg,
  },
  handleRow: { alignItems: 'center' as const, paddingTop: Spacing[3] },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  panelHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[2],
  },
  panelTitle: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text },
  showAll: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' as const },

  driverRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: Spacing[3],
    marginBottom: Spacing[2],
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  driverRowSelected: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: Spacing[3],
  },
  avatarText: { color: '#fff', fontWeight: '700' as const, fontSize: FontSize.sm },

  driverName: { fontSize: FontSize.base, fontWeight: '600' as const, color: Colors.text },
  vehicleNo: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  tripRoute: { fontSize: FontSize.xs, color: Colors.primary, marginTop: 2 },

  statusCol: { alignItems: 'flex-end' as const, gap: 4 },
  statusChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 10, fontWeight: '700' as const },
  lastSeen: { fontSize: 10, color: Colors.textMuted },

  emptyBox: { alignItems: 'center' as const, paddingVertical: Spacing[6] },
  emptyIcon: { fontSize: 28, marginBottom: 8 },
  emptyText: { color: Colors.textSecondary, fontSize: FontSize.sm },
};
