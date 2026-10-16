import { supabase } from '../supabaseConfig';
import { TripRecord } from './tripService';
import { Vehicle } from './vehicleService';
import { FuelLog } from './fuelService';

// trip id → total litres from its fuel logs
export type FuelByTrip = Map<string, number>;

export const fuelByTripFromLogs = (logs: FuelLog[]): FuelByTrip => {
  const map: FuelByTrip = new Map();
  for (const l of logs) {
    if (!l.tripId) continue;
    map.set(l.tripId, (map.get(l.tripId) ?? 0) + (Number(l.liters) || 0));
  }
  return map;
};

// Fuel for one trip: detailed fuel logs win when the trip has any (they're the
// record of every fill); otherwise the trip's quick-entry figure.
export const tripFuelLiters = (trip: TripRecord & { id: string }, fuelByTrip?: FuelByTrip): number => {
  const logged = fuelByTrip?.get(trip.id);
  if (logged !== undefined) return logged;
  return parseFloat(trip.fuelFilled ?? '0') || 0;
};

export const tripDistanceKm = (trip: TripRecord): number => parseFloat(trip.distanceTravelled ?? '0') || 0;

export interface VehicleStat {
  vehicleId: string;
  registrationNumber: string;
  trips: number;
  distanceKm: number;
  fuelLiters: number;
  kmPerLiter: number | null;
}

type Trip = TripRecord & { id: string };

const isCancelled = (t: Trip) => t.tripStatus === 'cancelled' || (t.status ?? '').toLowerCase() === 'cancelled';
const num = (v?: string) => parseFloat(v ?? '0') || 0;
const kmPerLiter = (km: number, liters: number) => (liters > 0 ? km / liters : null);

// Per-truck distance & fuel breakdown for a given (already date-range-filtered) set of trips.
export const vehicleStatsFromTrips = (
  trips: Trip[],
  vehicles: (Vehicle & { id: string })[],
  fuelByTrip?: FuelByTrip
): VehicleStat[] => {
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const map = new Map<string, { trips: number; distanceKm: number; fuelLiters: number }>();

  for (const t of trips) {
    if (isCancelled(t)) continue;
    const key = t.vehicleId || t.truck || 'Unknown';
    const entry = map.get(key) ?? { trips: 0, distanceKm: 0, fuelLiters: 0 };
    entry.trips += 1;
    entry.distanceKm += tripDistanceKm(t);
    entry.fuelLiters += tripFuelLiters(t, fuelByTrip);
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({
      vehicleId: key,
      registrationNumber: vehicleById.get(key)?.registrationNumber ?? key,
      trips: v.trips,
      distanceKm: v.distanceKm,
      fuelLiters: v.fuelLiters,
      kmPerLiter: kmPerLiter(v.distanceKm, v.fuelLiters),
    }))
    .sort((a, b) => b.distanceKm - a.distanceKm);
};

// ── Server-side date-range analytics (get_trip_analytics RPC) ─────────────
// Ranges up to 35 days aggregate trips directly; longer ranges read the
// trip_daily_stats rollup, so cost stays bounded as trip history grows.
export interface AnalyticsRow {
  vehicleId: string | null;
  driverId: string | null;
  trips: number;
  completed: number;
  distanceKm: number;
  fuelLiters: number;
}

export const getTripAnalytics = async (
  start: Date,
  end: Date,
  filters: { driverId?: string; vehicleId?: string } = {}
): Promise<AnalyticsRow[]> => {
  const { data, error } = await supabase.rpc('get_trip_analytics', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_driver_id: filters.driverId ?? null,
    p_vehicle_id: filters.vehicleId ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    vehicleId: r.vehicle_id ?? null,
    driverId: r.driver_id ?? null,
    trips: Number(r.trip_count) || 0,
    completed: Number(r.completed_count) || 0,
    distanceKm: Number(r.distance_km) || 0,
    fuelLiters: Number(r.fuel_liters) || 0,
  }));
};

export const vehicleStatsFromAnalytics = (
  rows: AnalyticsRow[],
  vehicles: (Vehicle & { id: string })[]
): VehicleStat[] => {
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const map = new Map<string, { trips: number; distanceKm: number; fuelLiters: number }>();
  for (const r of rows) {
    const key = r.vehicleId ?? 'Unknown';
    const entry = map.get(key) ?? { trips: 0, distanceKm: 0, fuelLiters: 0 };
    entry.trips += r.trips;
    entry.distanceKm += r.distanceKm;
    entry.fuelLiters += r.fuelLiters;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({
      vehicleId: key,
      registrationNumber: vehicleById.get(key)?.registrationNumber ?? (key === 'Unknown' ? 'Unassigned' : key),
      trips: v.trips,
      distanceKm: v.distanceKm,
      fuelLiters: v.fuelLiters,
      kmPerLiter: kmPerLiter(v.distanceKm, v.fuelLiters),
    }))
    .sort((a, b) => b.distanceKm - a.distanceKm);
};

// Per-truck stats for a range: server aggregation where available, falling back
// to the trips already loaded on the client (e.g. before the migration is applied).
export const getVehicleStatsForRange = async (
  range: { start: Date; end: Date; driverId?: string },
  fallbackTrips: Trip[],
  vehicles: (Vehicle & { id: string })[]
): Promise<{ stats: VehicleStat[]; source: 'server' | 'client' }> => {
  try {
    const rows = await getTripAnalytics(range.start, range.end, { driverId: range.driverId });
    return { stats: vehicleStatsFromAnalytics(rows, vehicles), source: 'server' };
  } catch {
    return { stats: vehicleStatsFromTrips(fallbackTrips, vehicles), source: 'client' };
  }
};

// ── Driver performance (HLD P1 dashboard) ─────────────────────────────────
export interface DriverPerformance {
  key: string;
  name: string;
  trips: number;
  completed: number;
  completionRate: number; // 0..1
  distanceKm: number;
  fuelLiters: number;
  kmPerLiter: number | null;
  avgTripHours: number | null;
}

export const driverPerformanceFromTrips = (
  trips: Trip[],
  driverNameById: Map<string, string>,
  fuelByTrip?: FuelByTrip
): DriverPerformance[] => {
  const map = new Map<string, DriverPerformance & { tripHours: number }>();
  for (const t of trips) {
    if (isCancelled(t)) continue;
    // Grouped by driverId (not name) so two drivers sharing a name aren't merged;
    // legacy trips without a driverId fall back to grouping by name.
    const key = t.driverId || `name:${t.driverName || 'Unknown'}`;
    const entry = map.get(key) ?? {
      key,
      name: (t.driverId && driverNameById.get(t.driverId)) || t.driverName || 'Unknown',
      trips: 0, completed: 0, completionRate: 0, distanceKm: 0, fuelLiters: 0,
      kmPerLiter: null, avgTripHours: null, tripHours: 0,
    };
    entry.trips += 1;
    entry.distanceKm += tripDistanceKm(t);
    entry.fuelLiters += tripFuelLiters(t, fuelByTrip);
    if (t.arrivalTime) {
      entry.completed += 1;
      const hours = (t.arrivalTime.getTime() - t.departureTime.getTime()) / 36e5;
      if (hours > 0) entry.tripHours += hours;
    }
    map.set(key, entry);
  }
  return Array.from(map.values()).map(({ tripHours, ...e }) => ({
    ...e,
    completionRate: e.trips > 0 ? e.completed / e.trips : 0,
    kmPerLiter: kmPerLiter(e.distanceKm, e.fuelLiters),
    avgTripHours: e.completed > 0 ? tripHours / e.completed : null,
  }));
};

// ── CSV export (HLD §6.3: generated client-side from fetched aggregates) ───
// Cells starting with = + - @ are prefixed with ' so spreadsheet apps don't
// execute them as formulas (CSV injection via e.g. a driver or company name).
const csvCell = (value: unknown): string => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (headers: string[], rows: unknown[][]): string =>
  [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');

export const buildAnalyticsCsv = (
  periodLabel: string,
  vehicles: VehicleStat[],
  drivers: DriverPerformance[]
): string => {
  const round = (n: number | null, digits = 1) => (n === null ? '' : n.toFixed(digits));
  const truckSection = toCsv(
    ['Truck', 'Trips', 'Distance (km)', 'Fuel (L)', 'km/L'],
    vehicles.map(v => [v.registrationNumber, v.trips, round(v.distanceKm, 0), round(v.fuelLiters, 0), round(v.kmPerLiter)])
  );
  const driverSection = toCsv(
    ['Driver', 'Trips', 'Completed', 'Completion %', 'Distance (km)', 'Fuel (L)', 'km/L', 'Avg trip (h)'],
    drivers.map(d => [
      d.name, d.trips, d.completed, Math.round(d.completionRate * 100),
      round(d.distanceKm, 0), round(d.fuelLiters, 0), round(d.kmPerLiter), round(d.avgTripHours),
    ])
  );
  return `${csvCell(`CargoTracker report - ${periodLabel}`)}\n\nPer truck\n${truckSection}\n\nPer driver\n${driverSection}\n`;
};
