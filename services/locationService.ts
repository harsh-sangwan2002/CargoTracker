import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabaseConfig';

export interface DriverLocation {
  userId: string;
  driverName: string;
  lat: number;
  lng: number;
  updatedAt: number;
  isTracking: boolean;
  tripRoute?: string;
}

const mapLocationRow = (row: any): DriverLocation => ({
  userId: row.user_id,
  driverName: row.driver_name ?? '',
  lat: row.lat,
  lng: row.lng,
  updatedAt: row.updated_at,
  isTracking: !!row.is_tracking,
  tripRoute: row.trip_route ?? undefined,
});

const fetchActiveLocations = async (callback: (locs: DriverLocation[]) => void) => {
  const { data, error } = await supabase.from('driver_locations').select('*').eq('is_tracking', true);
  if (!error) callback((data ?? []).map(mapLocationRow));
};

export const updateDriverLocation = async (userId: string, data: Omit<DriverLocation, 'userId'>) => {
  const { error } = await supabase.from('driver_locations').upsert({
    user_id: userId,
    driver_name: data.driverName,
    lat: data.lat,
    lng: data.lng,
    updated_at: data.updatedAt,
    is_tracking: data.isTracking,
    trip_route: data.tripRoute ?? null,
  });
  if (error) throw error;
};

export const clearDriverTracking = async (userId: string) => {
  const { error } = await supabase
    .from('driver_locations')
    .update({ updated_at: Date.now(), is_tracking: false })
    .eq('user_id', userId);
  if (error) throw error;
};

export const subscribeToActiveLocations = (callback: (locs: DriverLocation[]) => void) => {
  let channel: RealtimeChannel | null = null;
  fetchActiveLocations(callback).catch(() => {});

  channel = supabase
    .channel('driver-locations')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, () => {
      fetchActiveLocations(callback).catch(() => {});
    })
    .subscribe();

  return () => {
    if (channel) supabase.removeChannel(channel);
  };
};
