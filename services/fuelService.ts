import { supabase } from '../supabaseConfig';
import { clearCacheByPrefix, getCache, setCache, TTL } from '../utils/cache';

export interface FuelLog {
  id?: string;
  tripId?: string;
  vehicleId: string;
  liters: number;
  cost?: number;
  odometerReading?: number;
  fuelStation?: string;
  loggedBy?: string;
  loggedAt?: any;
}

const cacheKeyForVehicle = (vehicleId: string) => `fuel_logs_vehicle_${vehicleId}`;

const mapFuelLogRow = (row: any): FuelLog & { id: string } => ({
  id: row.id,
  tripId: row.trip_id ?? undefined,
  vehicleId: row.vehicle_id,
  liters: row.liters ?? 0,
  cost: row.cost ?? undefined,
  odometerReading: row.odometer_reading ?? undefined,
  fuelStation: row.fuel_station ?? '',
  loggedBy: row.logged_by ?? undefined,
  loggedAt: row.logged_at,
});

const cleanId = (value?: string) => (value?.trim() ? value.trim() : null);

export const addFuelLog = async (log: Omit<FuelLog, 'id' | 'loggedAt'>) => {
  const { data, error } = await supabase
    .from('fuel_logs')
    .insert({
      trip_id: cleanId(log.tripId),
      vehicle_id: log.vehicleId,
      liters: log.liters,
      cost: log.cost ?? null,
      odometer_reading: log.odometerReading ?? null,
      fuel_station: log.fuelStation || null,
      logged_by: cleanId(log.loggedBy),
    })
    .select('id')
    .single();
  if (error) throw error;
  await clearCacheByPrefix('fuel_logs_');
  return data.id as string;
};

export const getFuelLogsByTrip = async (tripId: string): Promise<(FuelLog & { id: string })[]> => {
  const { data, error } = await supabase
    .from('fuel_logs')
    .select('*')
    .eq('trip_id', tripId)
    .order('logged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapFuelLogRow);
};

export const getFuelLogsByVehicle = async (vehicleId: string): Promise<(FuelLog & { id: string })[]> => {
  const cacheKey = cacheKeyForVehicle(vehicleId);
  const cached = await getCache<(FuelLog & { id: string })[]>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('fuel_logs')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('logged_at', { ascending: false });
  if (error) throw error;
  const logs = (data ?? []).map(mapFuelLogRow);
  setCache(cacheKey, logs, TTL.SHORT);
  return logs;
};

// Rolling km/L for a vehicle: total distance covered between fills / total liters
// filled (excludes the earliest reading, which has no preceding distance to attribute).
export const computeRollingKmPerLiter = (logs: (FuelLog & { id: string })[]): number | null => {
  const withOdometer = logs
    .filter(l => l.odometerReading != null)
    .sort((a, b) => (a.odometerReading! - b.odometerReading!));
  if (withOdometer.length < 2) return null;

  const totalDistance = withOdometer[withOdometer.length - 1].odometerReading! - withOdometer[0].odometerReading!;
  const totalLiters = withOdometer.slice(1).reduce((sum, l) => sum + l.liters, 0);
  return totalLiters > 0 ? totalDistance / totalLiters : null;
};

export const deleteFuelLog = async (id: string) => {
  const { error } = await supabase.from('fuel_logs').delete().eq('id', id);
  if (error) throw error;
  await clearCacheByPrefix('fuel_logs_');
};
