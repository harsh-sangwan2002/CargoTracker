import { supabase } from '../supabaseConfig';
import { clearCacheByPrefix, getCache, setCache, TTL } from '../utils/cache';

export interface VehicleMaintenance {
  id?: string;
  vehicleId: string;
  maintenanceType: string;
  description?: string;
  cost?: number;
  odometerAtService?: number;
  serviceDate: string;
  nextServiceDueDate?: string;
  nextServiceDueOdometer?: number;
  vendor?: string;
  createdBy?: string;
  createdAt?: any;
}

const cacheKeyForVehicle = (vehicleId: string) => `vehicle_maintenance_vehicle_${vehicleId}`;

const cleanId = (value?: string) => (value?.trim() ? value.trim() : null);

const mapRow = (row: any): VehicleMaintenance & { id: string } => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  maintenanceType: row.maintenance_type ?? 'service',
  description: row.description ?? '',
  cost: row.cost ?? undefined,
  odometerAtService: row.odometer_at_service ?? undefined,
  serviceDate: row.service_date,
  nextServiceDueDate: row.next_service_due_date ?? undefined,
  nextServiceDueOdometer: row.next_service_due_odometer ?? undefined,
  vendor: row.vendor ?? '',
  createdBy: row.created_by ?? undefined,
  createdAt: row.created_at,
});

export const addVehicleMaintenance = async (entry: Omit<VehicleMaintenance, 'id' | 'createdAt'>) => {
  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .insert({
      vehicle_id: entry.vehicleId,
      maintenance_type: entry.maintenanceType,
      description: entry.description || null,
      cost: entry.cost ?? null,
      odometer_at_service: entry.odometerAtService ?? null,
      service_date: entry.serviceDate,
      next_service_due_date: entry.nextServiceDueDate || null,
      next_service_due_odometer: entry.nextServiceDueOdometer ?? null,
      vendor: entry.vendor || null,
      created_by: cleanId(entry.createdBy),
    })
    .select('id')
    .single();
  if (error) throw error;
  await clearCacheByPrefix('vehicle_maintenance_');
  return data.id as string;
};

export const getMaintenanceByVehicle = async (vehicleId: string): Promise<(VehicleMaintenance & { id: string })[]> => {
  const cacheKey = cacheKeyForVehicle(vehicleId);
  const cached = await getCache<(VehicleMaintenance & { id: string })[]>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('service_date', { ascending: false });
  if (error) throw error;
  const entries = (data ?? []).map(mapRow);
  setCache(cacheKey, entries, TTL.SHORT);
  return entries;
};

// Vehicles with maintenance due within `withinDays` (by date) or already overdue,
// used to surface upcoming-service alerts alongside document-expiry compliance alerts.
export const getUpcomingMaintenance = async (withinDays = 30): Promise<(VehicleMaintenance & { id: string })[]> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .select('*')
    .not('next_service_due_date', 'is', null)
    .lte('next_service_due_date', cutoff.toISOString().slice(0, 10))
    .order('next_service_due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
};

export const deleteVehicleMaintenance = async (id: string) => {
  const { error } = await supabase.from('vehicle_maintenance').delete().eq('id', id);
  if (error) throw error;
  await clearCacheByPrefix('vehicle_maintenance_');
};
