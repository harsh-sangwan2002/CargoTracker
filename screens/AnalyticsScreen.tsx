import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { getTrips, getTripsByUser, TripFirestore } from '../services/tripService';
import { getDrivers, Driver } from '../services/driverService';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole } from './MainTabsScreen';

interface Props {
  role: UserRole;
}

type DateRange = 'today' | 'week' | 'month' | 'all';

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const startOfWeek = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() - n.getDay()); n.setHours(0, 0, 0, 0); return n; };
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

/* Simple horizontal bar chart */
function BarChart({ data, color }: { data: { label: string; value: number; sub?: string }[]; color: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <View style={{ gap: Spacing[3] }}>
      {data.map((item, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>{item.label}</Text>
            <Text style={{ fontSize: FontSize.sm, color: Colors.textSecondary, marginLeft: Spacing[2] }}>
              {item.value}{item.sub ? ` ${item.sub}` : ''}
            </Text>
          </View>
          <View style={{ height: 10, backgroundColor: Colors.border, borderRadius: Radius.full, overflow: 'hidden' }}>
            <View
              style={{
                height: '100%',
                width: `${(item.value / max) * 100}%` as any,
                backgroundColor: color,
                borderRadius: Radius.full,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* Stat card */
function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <View style={[sc.card, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <Text style={sc.icon}>{icon}</Text>
      <Text style={[sc.value, { color }]}>{value}</Text>
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
    ...Shadow.md,
  },
  icon: { fontSize: 24, marginBottom: Spacing[2] },
  value: { fontSize: FontSize['2xl'], fontWeight: '800' as const, letterSpacing: -0.5 },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, fontWeight: '600' as const },
  sub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 1 },
};

export default function AnalyticsScreen({ role }: Props) {
  const user = auth.currentUser;
  const [allTrips, setAllTrips] = useState<(TripFirestore & { id: string })[]>([]);
  const [drivers, setDrivers] = useState<(Driver & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [showDriverPicker, setShowDriverPicker] = useState(false);

  const load = async () => {
    try {
      const [t, d] = await Promise.all([
        role === 'driver' ? getTripsByUser(user?.uid ?? '') : getTrips(),
        getDrivers(),
      ]);
      setAllTrips(t);
      setDrivers(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const now = new Date();
  const rangeStart: Record<DateRange, Date | null> = {
    today: startOfDay(now),
    week: startOfWeek(now),
    month: startOfMonth(now),
    all: null,
  };

  const start = rangeStart[dateRange];
  const filtered = allTrips.filter(t => {
    const afterStart = !start || (t.departureTime && t.departureTime >= start);
    const matchDriver = driverFilter === 'all' || t.driverName === driverFilter;
    return afterStart && matchDriver;
  });

  const totalTrips = filtered.length;
  const activeTrips = filtered.filter(t => !t.arrivalTime).length;
  const deliveredTrips = filtered.filter(t => !!t.arrivalTime).length;
  const totalFuel = filtered.reduce((s, t) => s + (parseFloat(t.fuelFilled) || 0), 0);
  const totalDist = filtered.reduce((s, t) => s + (parseFloat(t.distanceTravelled ?? '0') || 0), 0);
  const avgFuel = totalTrips > 0 ? (totalFuel / totalTrips).toFixed(1) : '0';

  // Trips per driver
  const driverMap: Record<string, number> = {};
  filtered.forEach(t => {
    const name = t.driverName || 'Unknown';
    driverMap[name] = (driverMap[name] || 0) + 1;
  });
  const driverChartData = Object.entries(driverMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));

  // Trips per day (last 7 days)
  const dayMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    dayMap[key] = 0;
  }
  filtered.forEach(t => {
    if (!t.departureTime) return;
    const d = new Date(t.departureTime);
    const key = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    if (key in dayMap) dayMap[key]++;
  });
  const dayChartData = Object.entries(dayMap).map(([label, value]) => ({ label, value }));

  const rangeLabels: Record<DateRange, string> = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
    all: 'All Time',
  };

  const selectedDriverLabel = driverFilter === 'all' ? 'All Drivers' : driverFilter;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
      >
        <Text style={s.pageTitle}>Reports</Text>

        {/* Date Range Filter */}
        <Text style={s.sectionLabel}>Date Range</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing[4] }}>
          {(['today', 'week', 'month', 'all'] as DateRange[]).map(r => (
            <TouchableOpacity
              key={r}
              style={[s.chip, dateRange === r && s.chipActive]}
              onPress={() => setDateRange(r)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, dateRange === r && s.chipTextActive]}>{rangeLabels[r]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Driver Filter */}
        <Text style={s.sectionLabel}>Driver Filter</Text>
        <TouchableOpacity
          style={s.driverFilterBtn}
          onPress={() => setShowDriverPicker(!showDriverPicker)}
          activeOpacity={0.8}
        >
          <Text style={s.driverFilterText}>👤 {selectedDriverLabel}</Text>
          <Text style={s.driverFilterArrow}>{showDriverPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showDriverPicker && (
          <View style={s.driverPicker}>
            <TouchableOpacity
              style={[s.driverOption, driverFilter === 'all' && s.driverOptionActive]}
              onPress={() => { setDriverFilter('all'); setShowDriverPicker(false); }}
            >
              <Text style={[s.driverOptionText, driverFilter === 'all' && s.driverOptionTextActive]}>All Drivers</Text>
            </TouchableOpacity>
            {drivers.map(d => (
              <TouchableOpacity
                key={d.id}
                style={[s.driverOption, driverFilter === d.fullName && s.driverOptionActive]}
                onPress={() => { setDriverFilter(d.fullName); setShowDriverPicker(false); }}
              >
                <Text style={[s.driverOptionText, driverFilter === d.fullName && s.driverOptionTextActive]}>{d.fullName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading ? (
          <View style={s.loaderCenter}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={s.loadingText}>Calculating...</Text>
          </View>
        ) : (
          <>
            {/* Stats */}
            <Text style={[s.sectionLabel, { marginTop: Spacing[5] }]}>Summary</Text>
            <View style={s.statsGrid}>
              <StatCard icon="🚛" label="Total Trips" value={totalTrips} color={Colors.primary} />
              <StatCard icon="✅" label="Delivered" value={deliveredTrips} color={Colors.success} />
              <StatCard icon="⚡" label="Active" value={activeTrips} color={Colors.warning} />
              <StatCard icon="⛽" label="Fuel Used" value={`${Math.round(totalFuel)}`} sub="liters" color={Colors.danger} />
              <StatCard icon="📏" label="Distance" value={`${Math.round(totalDist)}`} sub="km" color={Colors.info} />
              <StatCard icon="📊" label="Avg Fuel/Trip" value={`${avgFuel}`} sub="L" color={Colors.textSecondary} />
            </View>

            {/* Trips per driver */}
            {driverChartData.length > 0 && (
              <View style={s.chartCard}>
                <Text style={s.chartTitle}>Trips by Driver</Text>
                <Text style={s.chartSub}>
                  {rangeLabels[dateRange]}{driverFilter !== 'all' ? ` · ${driverFilter}` : ''}
                </Text>
                <View style={{ marginTop: Spacing[4] }}>
                  <BarChart data={driverChartData} color={Colors.primary} />
                </View>
              </View>
            )}

            {/* Trips per day */}
            {dateRange !== 'today' && (
              <View style={s.chartCard}>
                <Text style={s.chartTitle}>Daily Trips (Last 7 Days)</Text>
                <Text style={s.chartSub}>Trips by departure date</Text>
                <View style={{ marginTop: Spacing[4] }}>
                  <BarChart data={dayChartData} color={Colors.success} />
                </View>
              </View>
            )}

            {totalTrips === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyIcon}>📊</Text>
                <Text style={s.emptyText}>No data for this period</Text>
                <Text style={s.emptySub}>Try adjusting the date range or driver filter.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { padding: Spacing[5], paddingBottom: Spacing[10] } as const,

  pageTitle: {
    fontSize: FontSize['3xl'],
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: Spacing[5],
  },

  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: Spacing[2],
  },

  chip: {
    paddingHorizontal: Spacing[4],
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.surface,
    marginRight: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: '#fff' },

  driverFilterBtn: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing[4],
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: Spacing[2],
  },
  driverFilterText: { fontSize: FontSize.base, color: Colors.text, fontWeight: '500' as const },
  driverFilterArrow: { fontSize: FontSize.sm, color: Colors.textMuted },
  driverPicker: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing[3],
    overflow: 'hidden' as const,
    ...Shadow.md,
  },
  driverOption: {
    paddingVertical: 12,
    paddingHorizontal: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  driverOptionActive: { backgroundColor: Colors.primaryLight },
  driverOptionText: { fontSize: FontSize.base, color: Colors.text },
  driverOptionTextActive: { color: Colors.primary, fontWeight: '700' as const },

  loaderCenter: {
    alignItems: 'center' as const,
    paddingVertical: Spacing[10],
    gap: Spacing[3],
  },
  loadingText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  statsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: Spacing[3],
    marginBottom: Spacing[5],
  },

  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    marginBottom: Spacing[4],
    ...Shadow.md,
  },
  chartTitle: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.text },
  chartSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },

  empty: {
    alignItems: 'center' as const,
    paddingVertical: Spacing[10],
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.md, fontWeight: '700' as const, color: Colors.textSecondary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const },
};
