import { supabase } from '../supabaseConfig';
import { getCache, setCache, clearCacheByPrefix, TTL } from '../utils/cache';

export interface TripRecord {
  truck: string;
  bidNo: string;
  driverName: string;
  companyName: string;
  itemType: string;
  quantity: string;
  fuelFilled: string;
  distanceTravelled?: string;
  departureTime: Date;
  arrivalTime: Date | null;
  fromPlant: string;
  toPlant: string;
  status: string;
  time: string;
  userId?: string;
  driverUserId?: string;
  vehicleId?: string;
  driverId?: string;
  fromPlantId?: string;
  toPlantId?: string;
  odometerStart?: number;
  odometerEnd?: number;
  tripNumber?: string;
  createdAt: any;
}

const toDate = (value: any): Date => value ? new Date(value) : new Date(0);
const nullableDate = (value: any): Date | null => value ? new Date(value) : null;
const cleanId = (value?: string) => value?.trim() ? value.trim() : null;

const mapRow = (row: any): TripRecord & { id: string } => ({
  id: row.id,
  truck: row.truck ?? '',
  bidNo: row.bid_no ?? '',
  driverName: row.driver_name ?? '',
  companyName: row.company_name ?? '',
  itemType: row.item_type ?? '',
  quantity: row.quantity ?? '',
  fuelFilled: row.fuel_filled ?? '0',
  distanceTravelled: row.distance_travelled ?? '',
  departureTime: toDate(row.departure_time),
  arrivalTime: nullableDate(row.arrival_time),
  fromPlant: row.from_plant ?? '',
  toPlant: row.to_plant ?? '',
  status: row.status ?? '',
  time: row.time ?? '',
  userId: row.user_id ?? '',
  driverUserId: row.driver_user_id ?? '',
  vehicleId: row.vehicle_id ?? '',
  driverId: row.driver_id ?? '',
  fromPlantId: row.from_plant_id ?? '',
  toPlantId: row.to_plant_id ?? '',
  odometerStart: row.odometer_start ?? undefined,
  odometerEnd: row.odometer_end ?? undefined,
  tripNumber: row.trip_number ?? '',
  createdAt: row.created_at,
});

const tripStatusOf = (status?: string) => {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'delivered' || normalized === 'completed') return 'completed';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'pending') return 'pending';
  return 'active';
};

const toRow = (trip: Partial<TripRecord>) => ({
  truck: trip.truck,
  bid_no: trip.bidNo,
  driver_name: trip.driverName,
  company_name: trip.companyName,
  item_type: trip.itemType,
  quantity: trip.quantity,
  fuel_filled: trip.fuelFilled,
  fuel_filled_liters: trip.fuelFilled !== undefined ? (parseFloat(trip.fuelFilled) || 0) : undefined,
  distance_travelled: trip.distanceTravelled,
  distance_travelled_km: trip.distanceTravelled !== undefined ? (parseFloat(trip.distanceTravelled) || 0) : undefined,
  departure_time: trip.departureTime?.toISOString?.() ?? trip.departureTime,
  arrival_time: trip.arrivalTime ? trip.arrivalTime.toISOString() : null,
  from_plant: trip.fromPlant,
  to_plant: trip.toPlant,
  status: trip.status,
  trip_status: trip.status !== undefined ? tripStatusOf(trip.status) : undefined,
  time: trip.time,
  user_id: cleanId(trip.userId),
  driver_user_id: cleanId(trip.driverUserId),
  vehicle_id: cleanId(trip.vehicleId),
  driver_id: cleanId(trip.driverId),
  from_plant_id: cleanId(trip.fromPlantId),
  to_plant_id: cleanId(trip.toPlantId),
  odometer_start: trip.odometerStart,
  odometer_end: trip.odometerEnd,
});

const compactRow = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

const reviveTrip = (raw: any): TripRecord & { id: string } => ({
  ...raw,
  departureTime: raw.departureTime ? new Date(raw.departureTime) : new Date(0),
  arrivalTime: raw.arrivalTime ? new Date(raw.arrivalTime) : null,
});

const invalidateTripCache = () => clearCacheByPrefix('trips_');

export const addTrip = async (trip: Omit<TripRecord, 'createdAt'>) => {
  const { error } = await supabase.from('trips').insert(compactRow(toRow(trip)));
  if (error) throw error;
  await invalidateTripCache();
};

export const getTrips = async (): Promise<(TripRecord & { id: string })[]> => {
  const cached = await getCache<any[]>('trips_all');
  if (cached) return cached.map(reviveTrip);

  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const trips = (data ?? []).map(mapRow);
  setCache('trips_all', trips, TTL.SHORT);
  return trips;
};

export const getTripsByUser = async (driverUid: string): Promise<(TripRecord & { id: string })[]> => {
  const key = `trips_user_${driverUid}`;
  const cached = await getCache<any[]>(key);
  if (cached) return cached.map(reviveTrip);

  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('driver_user_id', driverUid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const trips = (data ?? []).map(mapRow);
  setCache(key, trips, TTL.SHORT);
  return trips;
};

export const getTripsByDateRange = async (
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<(TripRecord & { id: string })[]> => {
  let query = supabase
    .from('trips')
    .select('*')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .order('created_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapRow);
};

export const updateTrip = async (id: string, data: Partial<TripRecord>) => {
  const { error } = await supabase.from('trips').update(compactRow(toRow(data))).eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

export const startTrip = async (id: string) => {
  const { error } = await supabase
    .from('trips')
    .update({ departure_time: new Date().toISOString(), status: 'active', trip_status: 'active' })
    .eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

export const endTrip = async (id: string) => {
  const { error } = await supabase
    .from('trips')
    .update({ arrival_time: new Date().toISOString(), status: 'completed', trip_status: 'completed' })
    .eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

export const deleteTrip = async (id: string) => {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

// Live-updates a driver's trip list: whenever a trip belonging to this driver is
// inserted/updated/deleted, invalidate the local cache (writes on another device
// won't have cleared it) and refetch so newly assigned/reassigned trips show up
// without a manual pull-to-refresh.
export const subscribeToDriverTrips = (
  driverUid: string,
  callback: (trips: (TripRecord & { id: string })[]) => void
) => {
  const refetch = async () => {
    await invalidateTripCache();
    try {
      callback(await getTripsByUser(driverUid));
    } catch {}
  };

  const channel = supabase
    .channel(`trips-driver-${driverUid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trips', filter: `driver_user_id=eq.${driverUid}` },
      () => { refetch(); }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
};
