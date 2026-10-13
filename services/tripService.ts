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
// numeric columns are the source of truth (the DB computes distance_travelled_km from
// the odometer); the legacy text columns are only a fallback for old rows.
const numericOr = (num: any, legacy: any, fallback: string) =>
  num !== null && num !== undefined && num !== '' ? String(Number(num)) : (legacy ?? fallback);
const nullableDate = (value: any): Date | null => value ? new Date(value) : null;
// undefined = "not part of this update" (left untouched); '' = clear the link
const cleanId = (value?: string) => value === undefined ? undefined : (value.trim() ? value.trim() : null);

const mapRow = (row: any): TripRecord & { id: string } => ({
  id: row.id,
  truck: row.truck ?? '',
  bidNo: row.bid_no ?? '',
  driverName: row.driver_name ?? '',
  companyName: row.company_name ?? '',
  itemType: row.item_type ?? '',
  quantity: row.quantity ?? '',
  fuelFilled: numericOr(row.fuel_filled_liters, row.fuel_filled, '0'),
  distanceTravelled: numericOr(row.distance_travelled_km, row.distance_travelled, ''),
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

export const tripStatusOf = (status?: string) => {
  const normalized = (status ?? '').toLowerCase();
  if (normalized === 'delivered' || normalized === 'completed') return 'completed';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'pending') return 'pending';
  return 'active';
};

// A trip the driver has pressed "Start" on (startTrip sets status 'active').
// Legacy rows created by staff as 'Active' have not been started by the driver.
export const isTripStarted = (t: { status?: string; arrivalTime: Date | null }) =>
  t.status === 'active' && !t.arrivalTime;

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
  arrival_time: trip.arrivalTime === undefined ? undefined : (trip.arrivalTime ? trip.arrivalTime.toISOString() : null),
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

// PostgREST caps a response at the project's max-rows (1000 by default on Supabase),
// so read in pages; otherwise totals silently stop growing after 1000 trips.
const PAGE = 1000;
const fetchAllTrips = async (driverUid?: string): Promise<any[]> => {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from('trips').select('*');
    if (driverUid) query = query.eq('driver_user_id', driverUid);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
};

export const addTrip = async (trip: Omit<TripRecord, 'createdAt'>) => {
  const { error } = await supabase.from('trips').insert(compactRow(toRow(trip)));
  if (error) throw error;
  await invalidateTripCache();
};

export const getTrips = async (): Promise<(TripRecord & { id: string })[]> => {
  const cached = await getCache<any[]>('trips_all');
  if (cached) return cached.map(reviveTrip);

  const trips = (await fetchAllTrips()).map(mapRow);
  setCache('trips_all', trips, TTL.SHORT);
  return trips;
};

export const getTripsByUser = async (driverUid: string): Promise<(TripRecord & { id: string })[]> => {
  const key = `trips_user_${driverUid}`;
  const cached = await getCache<any[]>(key);
  if (cached) return cached.map(reviveTrip);

  const trips = (await fetchAllTrips(driverUid)).map(mapRow);
  setCache(key, trips, TTL.SHORT);
  return trips;
};

export const updateTrip = async (id: string, data: Partial<TripRecord>) => {
  const { error } = await supabase.from('trips').update(compactRow(toRow(data))).eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

// `at` is when the driver tapped Start/End — passed explicitly when the action was
// queued offline and is replayed later.
export const startTrip = async (id: string, at: Date = new Date()) => {
  const { error } = await supabase
    .from('trips')
    .update({ departure_time: at.toISOString(), status: 'active', trip_status: 'active' })
    .eq('id', id);
  if (error) throw error;
  await invalidateTripCache();
};

export const endTrip = async (id: string, at: Date = new Date()) => {
  const { error } = await supabase
    .from('trips')
    .update({ arrival_time: at.toISOString(), status: 'completed', trip_status: 'completed' })
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
