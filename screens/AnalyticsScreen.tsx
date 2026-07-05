import React, {useState, useEffect, useMemo, useRef} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Platform,
  Animated,
  PanResponder
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {SafeAreaView} from 'react-native-safe-area-context';
import {auth} from '../supabaseConfig';
import {getTrips, getTripsByUser, TripRecord} from '../services/tripService';
import {getDrivers, Driver} from '../services/driverService';
import {getVehicles, Vehicle} from '../services/vehicleService';
import {vehicleStatsFromTrips} from '../services/analyticsService';
import {Colors, FontSize, Radius, Shadow, Spacing} from '../utils/theme';
import {ShimmerStatsRow, ShimmerList} from '../components/Shimmer';
import type {UserRole} from './MainTabsScreen';

interface Props {
  role: UserRole;
}

type DateRange = 'today' | 'week' | 'month' | 'all' | 'custom';

/* ── Reliable date key helpers ─────────────────────────────────────── */
const dateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfDay = (d: Date) => {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
};
const endOfDay = (d: Date) => {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
};
const startOfWeek = (d: Date) => {
  const n = new Date(d);
  n.setDate(n.getDate() - n.getDay());
  n.setHours(0, 0, 0, 0);
  return n;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'});

/* ── Bar chart ─────────────────────────────────────────────────────── */
function BarChart({data, color}: {data: {label: string; value: number; sub?: string}[]; color: string}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={{gap: Spacing[3]}}>
      {data.map((item, i) => (
        <View key={i}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}}>
            <Text style={{fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', flex: 1}} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={{fontSize: FontSize.sm, color: Colors.textSecondary, marginLeft: Spacing[2]}}>
              {item.value}
              {item.sub ? ` ${item.sub}` : ''}
            </Text>
          </View>
          <View style={{height: 10, backgroundColor: Colors.border, borderRadius: Radius.full, overflow: 'hidden'}}>
            <View
              style={{
                height: '100%',
                width: `${(item.value / max) * 100}%` as any,
                backgroundColor: color,
                borderRadius: Radius.full
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ── Stat card ─────────────────────────────────────────────────────── */
function StatCard({
  icon,
  label,
  value,
  sub,
  color
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <View style={[sc.card, {borderLeftColor: color, borderLeftWidth: 4}]}>
      <Text style={sc.icon}>{icon}</Text>
      <Text style={[sc.value, {color}]}>{value}</Text>
      <Text style={sc.label}>{label}</Text>
      {sub ? <Text style={sc.sub}>{sub}</Text> : null}
    </View>
  );
}
const sc = {
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    width: '47.5%' as const,
    ...Shadow.md
  },
  icon: {fontSize: 22, marginBottom: Spacing[2]},
  value: {fontSize: FontSize['2xl'], fontWeight: '800' as const, letterSpacing: -0.5},
  label: {fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, fontWeight: '600' as const},
  sub: {fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1}
};

/* ── Driver summary row ────────────────────────────────────────────── */
function DriverSummaryCard({
  name,
  trips,
  fuel,
  distance,
  completedTrips,
  avgTripHours,
}: {
  name: string;
  trips: number;
  fuel: number;
  distance: number;
  completedTrips: number;
  avgTripHours: number | null;
}) {
  const completionPct = trips > 0 ? Math.round((completedTrips / trips) * 100) : 0;
  return (
    <View style={ds.card}>
      <View style={ds.avatar}>
        <Text style={ds.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
      </View>
      <View style={{flex: 1}}>
        <Text style={ds.name}>{name}</Text>
        <View style={ds.metaRow}>
          <Text style={ds.meta}>
            🚛 {trips} trip{trips !== 1 ? 's' : ''}
          </Text>
          <Text style={ds.meta}>⛽ {fuel.toFixed(0)} L</Text>
          {distance > 0 && <Text style={ds.meta}>📏 {distance.toFixed(0)} km</Text>}
        </View>
        <View style={ds.metaRow}>
          <Text style={ds.meta}>✅ {completionPct}% completed</Text>
          {avgTripHours !== null && <Text style={ds.meta}>⏱ {avgTripHours.toFixed(1)}h avg</Text>}
        </View>
      </View>
    </View>
  );
}
const ds = {
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: Spacing[3]
  },
  avatarText: {fontSize: FontSize.md, fontWeight: '800' as const, color: Colors.primary},
  name: {fontSize: FontSize.base, fontWeight: '700' as const, color: Colors.text, marginBottom: 4},
  metaRow: {flexDirection: 'row' as const, gap: Spacing[3]},
  meta: {fontSize: FontSize.xs, color: Colors.textSecondary}
};

/* ── Main screen ───────────────────────────────────────────────────── */
export default function AnalyticsScreen({role}: Props) {
  const user = auth.currentUser;

  const [allTrips, setAllTrips] = useState<(TripRecord & {id: string})[]>([]);
  const [drivers, setDrivers] = useState<(Driver & {id: string})[]>([]);
  const [vehicles, setVehicles] = useState<(Vehicle & {id: string})[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Date range
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [customFrom, setCustomFrom] = useState<Date>(() => startOfMonth(new Date()));
  const [customTo, setCustomTo] = useState<Date>(() => endOfDay(new Date()));
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to'>('from');

  const closeDatePicker = () => {
    setShowFromPicker(false);
    setShowToPicker(false);
  };

  const dateSheetSwipeY = useRef(new Animated.Value(0)).current;
  const dateSheetPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => gs.dy > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
    onPanResponderMove: (_, gs) => { if (gs.dy > 0) dateSheetSwipeY.setValue(gs.dy); },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 120 || gs.vy > 0.5) {
        Animated.timing(dateSheetSwipeY, { toValue: 800, duration: 200, useNativeDriver: true })
          .start(() => { dateSheetSwipeY.setValue(0); closeDatePicker(); });
      } else {
        Animated.spring(dateSheetSwipeY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  })).current;

  // Driver filter (searchable) — stores the driver's id ('all' for no filter),
  // since names alone can't disambiguate two drivers who share the same name.
  const [driverSearch, setDriverSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);

  const driversById = useMemo(() => new Map(drivers.map(d => [d.id, d])), [drivers]);
  const selectedDriver = driverFilter !== 'all' ? driversById.get(driverFilter) : undefined;

  const maskAadhaar = (aadhaar?: string) => {
    const digits = (aadhaar ?? '').replace(/\D/g, '');
    return digits.length >= 4 ? `•••• •••• ${digits.slice(-4)}` : '';
  };

  // A trip belongs to a driver if its driverId matches; trips created before the
  // relational migration may lack driverId, so fall back to a name match for those.
  const tripMatchesDriver = (t: TripRecord, driverId: string) => {
    if (t.driverId) return t.driverId === driverId;
    const d = driversById.get(driverId);
    return !!d && t.driverName === d.fullName;
  };

  const load = async () => {
    try {
      const [t, d, v] = await Promise.all([
        role === 'driver' ? getTripsByUser(user?.uid ?? '') : getTrips(),
        getDrivers(),
        getVehicles()
      ]);
      setAllTrips(t);
      setDrivers(d);
      setVehicles(v);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const now = new Date();

  /* ── Date range bounds ─────────────────────────────────────────── */
  const {rangeStart, rangeEnd} = useMemo(() => {
    switch (dateRange) {
      case 'today':
        return {rangeStart: startOfDay(now), rangeEnd: endOfDay(now)};
      case 'week':
        return {rangeStart: startOfWeek(now), rangeEnd: endOfDay(now)};
      case 'month':
        return {rangeStart: startOfMonth(now), rangeEnd: endOfDay(now)};
      case 'custom':
        return {rangeStart: startOfDay(customFrom), rangeEnd: endOfDay(customTo)};
      default:
        return {rangeStart: null, rangeEnd: null};
    }
  }, [dateRange, customFrom, customTo]);

  /* ── Filtered trips ────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return allTrips.filter((t) => {
      if (rangeStart && t.departureTime && t.departureTime < rangeStart) return false;
      if (rangeEnd && t.departureTime && t.departureTime > rangeEnd) return false;
      if (driverFilter !== 'all' && !tripMatchesDriver(t, driverFilter)) return false;
      return true;
    });
  }, [allTrips, rangeStart, rangeEnd, driverFilter, driversById]);

  /* ── Summary stats ─────────────────────────────────────────────── */
  const totalTrips = filtered.length;
  const activeTrips = filtered.filter((t) => !t.arrivalTime).length;
  const deliveredTrips = filtered.filter((t) => !!t.arrivalTime).length;
  const totalFuel = filtered.reduce((s, t) => s + (parseFloat(t.fuelFilled) || 0), 0);
  const totalDist = filtered.reduce((s, t) => s + (parseFloat(t.distanceTravelled ?? '0') || 0), 0);
  const avgFuel = totalTrips > 0 ? (totalFuel / totalTrips).toFixed(1) : '0';

  /* ── Trips per driver ──────────────────────────────────────────── */
  // Grouped by driverId (not name) so two drivers sharing a name aren't merged into
  // one row; legacy trips without a driverId still fall back to grouping by name.
  const driverStats = useMemo(() => {
    const map: Record<string, {label: string; trips: number; fuel: number; distance: number; completedTrips: number; totalTripHours: number}> = {};
    filtered.forEach((t) => {
      const key = t.driverId || `name:${t.driverName || 'Unknown'}`;
      const driver = t.driverId ? driversById.get(t.driverId) : undefined;
      if (!map[key]) map[key] = { label: driver?.fullName || t.driverName || 'Unknown', trips: 0, fuel: 0, distance: 0, completedTrips: 0, totalTripHours: 0 };
      map[key].trips++;
      map[key].fuel += parseFloat(t.fuelFilled) || 0;
      map[key].distance += parseFloat(t.distanceTravelled ?? '0') || 0;
      if (t.arrivalTime) {
        map[key].completedTrips++;
        const hours = (t.arrivalTime.getTime() - t.departureTime.getTime()) / (1000 * 60 * 60);
        if (hours > 0) map[key].totalTripHours += hours;
      }
    });

    const labelCounts: Record<string, number> = {};
    Object.values(map).forEach(v => { labelCounts[v.label] = (labelCounts[v.label] || 0) + 1; });

    return Object.entries(map)
      .map(([key, v]) => {
        let label = v.label;
        if (labelCounts[v.label] > 1) {
          const aadhaar = maskAadhaar(driversById.get(key)?.aadhaarCard);
          if (aadhaar) label = `${v.label} (${aadhaar})`;
        }
        return [label, v] as [string, typeof v];
      })
      .sort((a, b) => b[1].trips - a[1].trips)
      .slice(0, 10);
  }, [filtered, driversById]);

  const driverChartData = driverStats.map(([label, v]) => ({label, value: v.trips}));

  /* ── Per-truck distance & fuel breakdown ───────────────────────── */
  const vehicleStats = useMemo(() => vehicleStatsFromTrips(filtered, vehicles), [filtered, vehicles]);

  /* ── Fixed 7-day chart using reliable date keys ────────────────── */
  const dayChartData = useMemo(() => {
    // Always use all trips filtered only by driver (not date range) so we always see last 7 days
    const driverOnlyFiltered = allTrips.filter((t) => driverFilter === 'all' || tripMatchesDriver(t, driverFilter));

    const last7: {key: string; label: string}[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      last7.push({
        key: dateKey(d),
        label: d.toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'})
      });
    }

    const countMap: Record<string, number> = {};
    last7.forEach((d) => {
      countMap[d.key] = 0;
    });

    driverOnlyFiltered.forEach((t) => {
      if (!t.departureTime) return;
      const k = dateKey(new Date(t.departureTime));
      if (k in countMap) countMap[k]++;
    });

    return last7.map((d) => ({label: d.label, value: countMap[d.key]}));
  }, [allTrips, driverFilter, driversById]);

  /* ── Driver dropdown list (filtered by search) ─────────────────── */
  const filteredDriverList = useMemo(() => {
    const q = driverSearch.toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) => d.fullName.toLowerCase().includes(q));
  }, [drivers, driverSearch]);

  const rangeLabels: Record<DateRange, string> = {
    custom: 'Custom Range',
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    all: 'All Time'
  };

  const openDatePicker = (target: 'from' | 'to') => {
    setPickerTarget(target);
    setTempDate(target === 'from' ? customFrom : customTo);
    if (target === 'from') setShowFromPicker(true);
    else setShowToPicker(true);
  };

  const applyDate = (date: Date) => {
    if (pickerTarget === 'from') setCustomFrom(startOfDay(date));
    else setCustomTo(endOfDay(date));
  };

  const selectedDriverLabel = driverFilter === 'all' ? 'All Drivers' : (selectedDriver?.fullName ?? 'Unknown Driver');

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={Colors.primary}
          />
        }>
        <Text style={s.pageTitle}>Reports</Text>

        {/* ── Date Range Chips ───────────────────────────────────── */}
        <Text style={s.sectionLabel}>Period</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: Spacing[3]}}>
          {(['all', 'today', 'custom', 'week', 'month'] as DateRange[]).map((r) => (
            <TouchableOpacity
              key={r}
              style={[s.chip, dateRange === r && s.chipActive]}
              onPress={() => setDateRange(r)}
              activeOpacity={0.8}>
              <Text style={[s.chipText, dateRange === r && s.chipTextActive]}>
                {r === 'custom' ? '📅 Custom' : rangeLabels[r]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Custom date range pickers ─────────────────────────── */}
        {dateRange === 'custom' && (
          <View style={s.customRangeRow}>
            <TouchableOpacity style={s.dateRangeBtn} onPress={() => openDatePicker('from')} activeOpacity={0.8}>
              <Text style={s.dateRangeBtnLabel}>FROM</Text>
              <Text style={s.dateRangeBtnValue}>{fmtDate(customFrom)}</Text>
            </TouchableOpacity>
            <View style={s.dateRangeSep}>
              <Text style={s.dateRangeSepText}>→</Text>
            </View>
            <TouchableOpacity style={s.dateRangeBtn} onPress={() => openDatePicker('to')} activeOpacity={0.8}>
              <Text style={s.dateRangeBtnLabel}>TO</Text>
              <Text style={s.dateRangeBtnValue}>{fmtDate(customTo)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Searchable Driver Filter ──────────────────────────── */}
        <View style={s.driverLabelRow}>
          <Text style={[s.sectionLabel, {marginTop: Spacing[4], marginBottom: 0}]}>Driver</Text>
          <TouchableOpacity
            style={[s.allDriversBtn, driverFilter === 'all' && s.allDriversBtnActive]}
            onPress={() => {
              setDriverFilter('all');
              setDriverSearch('');
              setShowDriverDropdown(false);
            }}
            activeOpacity={0.8}>
            <Text style={[s.allDriversBtnText, driverFilter === 'all' && s.allDriversBtnTextActive]}>
              🚛 All Drivers
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{zIndex: 100, elevation: 10, marginBottom: showDriverDropdown ? 0 : Spacing[2]}}>
          <View style={s.driverSearchBox}>
            <Text style={s.driverSearchIcon}>👤</Text>
            <TextInput
              style={s.driverSearchInput}
              placeholder="Search or select driver..."
              placeholderTextColor={Colors.textMuted}
              value={driverSearch}
              onChangeText={(t) => {
                setDriverSearch(t);
                setShowDriverDropdown(true);
              }}
              onFocus={() => setShowDriverDropdown(true)}
            />
            {driverFilter !== 'all' && (
              <TouchableOpacity
                onPress={() => {
                  setDriverFilter('all');
                  setDriverSearch('');
                }}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={{fontSize: 18, color: Colors.textMuted}}>✕</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowDriverDropdown((v) => !v)}>
              <Text style={s.driverFilterArrow}>{showDriverDropdown ? '▲' : '▼'}</Text>
            </TouchableOpacity>
          </View>

          {/* Selected badge */}
          {driverFilter !== 'all' && (
            <View style={s.selectedBadge}>
              <Text style={s.selectedBadgeText}>Filtered: {selectedDriverLabel}</Text>
            </View>
          )}

          {/* Dropdown */}
          {showDriverDropdown && (
            <View style={s.driverDropdown}>
              <ScrollView nestedScrollEnabled style={{maxHeight: 240}} keyboardShouldPersistTaps="handled">
                <TouchableOpacity
                  style={[s.driverOption, driverFilter === 'all' && s.driverOptionActive]}
                  onPress={() => {
                    setDriverFilter('all');
                    setDriverSearch('');
                    setShowDriverDropdown(false);
                  }}>
                  <Text style={[s.driverOptionText, driverFilter === 'all' && s.driverOptionTextActive]}>
                    🚛 All Drivers ({allTrips.length} trips)
                  </Text>
                </TouchableOpacity>
                {filteredDriverList.length === 0 && driverSearch.trim() ? (
                  <View style={s.driverOption}>
                    <Text style={s.driverOptionText}>No driver named "{driverSearch}" found</Text>
                  </View>
                ) : (
                  filteredDriverList.map((d) => {
                    const tripCount = allTrips.filter((t) => tripMatchesDriver(t, d.id)).length;
                    const aadhaar = maskAadhaar(d.aadhaarCard);
                    return (
                      <TouchableOpacity
                        key={d.id}
                        style={[s.driverOption, driverFilter === d.id && s.driverOptionActive]}
                        onPress={() => {
                          setDriverFilter(d.id);
                          setDriverSearch(d.fullName);
                          setShowDriverDropdown(false);
                        }}>
                        <Text style={[s.driverOptionText, driverFilter === d.id && s.driverOptionTextActive]}>
                          {d.fullName}
                        </Text>
                        <Text style={s.driverOptionSub}>
                          {aadhaar ? `Aadhaar ${aadhaar} · ` : ''}{tripCount} trip{tripCount !== 1 ? 's' : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          )}
        </View>

        {loading ? (
          <View style={{marginTop: Spacing[4]}}>
            <ShimmerStatsRow />
            <ShimmerList count={4} />
          </View>
        ) : (
          <Pressable onPress={() => setShowDriverDropdown(false)}>
            {/* ── Summary stats ─────────────────────────────────── */}
            <Text style={[s.sectionLabel, {marginTop: Spacing[5]}]}>Summary · {rangeLabels[dateRange]}</Text>
            <View style={s.statsGrid}>
              <StatCard icon="🚛" label="Total Trips" value={totalTrips} color={Colors.primary} />
              <StatCard icon="✅" label="Delivered" value={deliveredTrips} color={Colors.success} />
              <StatCard icon="⚡" label="Active" value={activeTrips} color={Colors.warning} />
              <StatCard icon="⛽" label="Fuel Used" value={Math.round(totalFuel)} sub="L" color={Colors.danger} />
              <StatCard icon="📏" label="Distance" value={Math.round(totalDist)} sub="km" color={Colors.info} />
              <StatCard icon="📊" label="Avg Fuel/Trip" value={avgFuel} sub="L" color={Colors.textSecondary} />
            </View>

            {/* ── Trips by driver (detailed) ─────────────────────── */}
            {driverStats.length > 0 && (
              <View style={s.chartCard}>
                <Text style={s.chartTitle}>Driver Breakdown</Text>
                <Text style={s.chartSub}>
                  {rangeLabels[dateRange]}
                  {driverFilter !== 'all' ? ` · ${selectedDriverLabel}` : ''}
                </Text>

                {/* Bar chart */}
                <View style={{marginTop: Spacing[4], marginBottom: Spacing[4]}}>
                  <BarChart data={driverChartData} color={Colors.primary} />
                </View>

                {/* Detailed per-driver rows */}
                {driverStats.map(([name, v]) => (
                  <DriverSummaryCard
                    key={name}
                    name={name}
                    trips={v.trips}
                    fuel={v.fuel}
                    distance={v.distance}
                    completedTrips={v.completedTrips}
                    avgTripHours={v.completedTrips > 0 ? v.totalTripHours / v.completedTrips : null}
                  />
                ))}
              </View>
            )}

            {/* ── Per Truck breakdown ─────────────────────────────── */}
            {vehicleStats.length > 0 && (
              <View style={s.chartCard}>
                <Text style={s.chartTitle}>Per Truck</Text>
                <Text style={s.chartSub}>Distance & fuel · {rangeLabels[dateRange]}</Text>

                {vehicleStats.map(v => (
                  <View key={v.vehicleId} style={ds.card}>
                    <View style={ds.avatar}>
                      <Text style={ds.avatarText}>🚛</Text>
                    </View>
                    <View style={{flex: 1}}>
                      <Text style={ds.name}>{v.registrationNumber}</Text>
                      <View style={ds.metaRow}>
                        <Text style={ds.meta}>🚛 {v.trips} trip{v.trips !== 1 ? 's' : ''}</Text>
                        <Text style={ds.meta}>📏 {v.distanceKm.toFixed(0)} km</Text>
                        <Text style={ds.meta}>⛽ {v.fuelLiters.toFixed(0)} L</Text>
                        {v.kmPerLiter !== null && <Text style={ds.meta}>⚙️ {v.kmPerLiter.toFixed(1)} km/L</Text>}
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* ── Daily Trips — last 7 days (fixed) ─────────────── */}
            <View style={s.chartCard}>
              <Text style={s.chartTitle}>Last 7 Days</Text>
              <Text style={s.chartSub}>
                Trips by departure date{driverFilter !== 'all' ? ` · ${selectedDriverLabel}` : ''}
              </Text>
              {dayChartData.every((d) => d.value === 0) ? (
                <Text
                  style={{marginTop: Spacing[4], fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center'}}>
                  No trips in the last 7 days
                </Text>
              ) : (
                <View style={{marginTop: Spacing[4]}}>
                  <BarChart data={dayChartData} color={Colors.success} />
                </View>
              )}
            </View>

            {totalTrips === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyIcon}>📊</Text>
                <Text style={s.emptyText}>No trips match this filter</Text>
                <Text style={s.emptySub}>Try a different date range or driver.</Text>
              </View>
            )}
          </Pressable>
        )}
      </ScrollView>

      {/* ── Date Picker Modals ─────────────────────────────────────── */}
      {(showFromPicker || showToPicker) && (
        <Modal
          transparent
          visible
          animationType="slide"
          onRequestClose={closeDatePicker}>
          <View style={dp.overlay}>
            <Animated.View style={[dp.sheet, { transform: [{ translateY: dateSheetSwipeY }] }]}>
              <View style={dp.dragHeader} {...dateSheetPan.panHandlers}>
                <View style={dp.handle} />
                <Text style={dp.sheetTitle}>{showFromPicker ? 'Select From Date' : 'Select To Date'}</Text>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={(_, d) => {
                  if (d) setTempDate(d);
                  if (Platform.OS === 'android') {
                    if (d) applyDate(d);
                    closeDatePicker();
                  }
                }}
                maximumDate={pickerTarget === 'from' ? customTo : new Date()}
                minimumDate={pickerTarget === 'to' ? customFrom : undefined}
              />
              {Platform.OS === 'ios' && (
                <View style={dp.iosBtns}>
                  <Pressable style={dp.cancelBtn} onPress={closeDatePicker}>
                    <Text style={dp.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={dp.confirmBtn}
                    onPress={() => {
                      applyDate(tempDate);
                      closeDatePicker();
                    }}>
                    <Text style={dp.confirmText}>Confirm</Text>
                  </Pressable>
                </View>
              )}
            </Animated.View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────── */
const s = {
  safe: {flex: 1, backgroundColor: Colors.background} as const,
  scroll: {padding: Spacing[5], paddingBottom: Spacing[10]} as const,

  pageTitle: {
    fontSize: FontSize['3xl'],
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: Spacing[5]
  },

  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: Spacing[2]
  },

  chip: {
    paddingHorizontal: Spacing[4],
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    marginRight: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.border
  },
  chipActive: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  chipText: {fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary},
  chipTextActive: {color: '#fff'},

  customRangeRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing[2],
    marginBottom: Spacing[2]
  },
  dateRangeBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing[3],
    borderWidth: 1.5,
    borderColor: Colors.primary,
    ...Shadow.sm
  },
  dateRangeBtnLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
    marginBottom: 2
  },
  dateRangeBtnValue: {fontSize: FontSize.sm, fontWeight: '700' as const, color: Colors.text},
  dateRangeSep: {paddingHorizontal: Spacing[1]} as const,
  dateRangeSepText: {fontSize: FontSize.lg, color: Colors.textMuted},

  driverSearchBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing[3],
    borderWidth: 1.5,
    borderColor: Colors.border
  },
  driverSearchIcon: {fontSize: 16, marginRight: Spacing[2]},
  driverSearchInput: {flex: 1, fontSize: FontSize.base, color: Colors.text, paddingVertical: 12, letterSpacing: 0},
  driverFilterArrow: {fontSize: FontSize.sm, color: Colors.textMuted, paddingLeft: Spacing[2]},
  selectedBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
    marginTop: Spacing[2],
    alignSelf: 'flex-start' as const
  },
  selectedBadgeText: {fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700' as const},
  driverDropdown: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing[1],
    overflow: 'hidden' as const,
    ...Shadow.lg
  },
  driverOption: {
    paddingVertical: 12,
    paddingHorizontal: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border
  },
  driverOptionActive: {backgroundColor: Colors.primaryLight},
  driverOptionText: {fontSize: FontSize.base, color: Colors.text},
  driverOptionTextActive: {color: Colors.primary, fontWeight: '700' as const},
  driverOptionSub: {fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2},

  loaderCenter: {alignItems: 'center' as const, paddingVertical: Spacing[10], gap: Spacing[3]},
  loadingText: {fontSize: FontSize.sm, color: Colors.textSecondary},

  statsGrid: {flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Spacing[3], marginBottom: Spacing[5]},

  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    marginBottom: Spacing[4],
    ...Shadow.md
  },
  chartTitle: {fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text},
  chartSub: {fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2},

  driverLabelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: Spacing[4],
    marginBottom: Spacing[2]
  },
  allDriversBtn: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border
  },
  allDriversBtnActive: {backgroundColor: Colors.primary, borderColor: Colors.primary},
  allDriversBtnText: {fontSize: FontSize.xs, fontWeight: '700' as const, color: Colors.textSecondary},
  allDriversBtnTextActive: {color: '#fff'},

  empty: {alignItems: 'center' as const, paddingVertical: Spacing[10]},
  emptyIcon: {fontSize: 48, marginBottom: Spacing[3]},
  emptyText: {fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.textSecondary},
  emptySub: {fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const}
};

const dp = {
  overlay: {flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.45)'},
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: Spacing[1]
  },
  dragHeader: {
    alignItems: 'center' as const,
    paddingTop: Spacing[1],
    paddingBottom: Spacing[1]
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center' as const,
    marginBottom: Spacing[3]
  },
  sheetTitle: {
    fontSize: FontSize.md,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: Spacing[2]
  },
  iosBtns: {flexDirection: 'row' as const, borderTopWidth: 1, borderTopColor: Colors.border},
  cancelBtn: {flex: 1, paddingVertical: 16, alignItems: 'center' as const, backgroundColor: Colors.surfaceAlt},
  cancelText: {fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' as const},
  confirmBtn: {flex: 1, paddingVertical: 16, alignItems: 'center' as const, backgroundColor: Colors.primary},
  confirmText: {fontSize: FontSize.md, color: '#fff', fontWeight: '700' as const}
};
