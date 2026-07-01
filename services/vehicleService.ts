import { supabase } from '../supabaseConfig';
import { getCache, setCache, clearCache, TTL } from '../utils/cache';

export interface Vehicle {
  id?: string;
  registrationNumber: string;
  type?: string;
  capacityTons?: number;
  fuelType?: string;
  odometerReading?: number;
  insuranceExpiry?: string;
  permitExpiry?: string;
  pucExpiry?: string;
  status?: 'active' | 'in_maintenance' | 'retired';
  createdAt?: any;
}

const CACHE_KEY = 'vehicles_all';

const mapVehicleRow = (row: any): Vehicle & { id: string } => ({
  id: row.id,
  registrationNumber: row.registration_number ?? '',
  type: row.type ?? '',
  capacityTons: row.capacity_tons ?? undefined,
  fuelType: row.fuel_type ?? '',
  odometerReading: row.odometer_reading ?? 0,
  insuranceExpiry: row.insurance_expiry ?? '',
  permitExpiry: row.permit_expiry ?? '',
  pucExpiry: row.puc_expiry ?? '',
  status: row.status ?? 'active',
  createdAt: row.created_at,
});

const toVehicleRow = (vehicle: Partial<Vehicle>) => ({
  registration_number: vehicle.registrationNumber?.trim().toUpperCase(),
  type: vehicle.type || null,
  capacity_tons: vehicle.capacityTons ?? null,
  fuel_type: vehicle.fuelType || null,
  insurance_expiry: vehicle.insuranceExpiry !== undefined ? (vehicle.insuranceExpiry || null) : undefined,
  permit_expiry: vehicle.permitExpiry !== undefined ? (vehicle.permitExpiry || null) : undefined,
  puc_expiry: vehicle.pucExpiry !== undefined ? (vehicle.pucExpiry || null) : undefined,
  status: vehicle.status || undefined,
  updated_at: new Date().toISOString(),
});

const compactRow = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

export const addVehicle = async (vehicle: Omit<Vehicle, 'id' | 'createdAt'>) => {
  const { data, error } = await supabase
    .from('vehicles')
    .insert(compactRow(toVehicleRow(vehicle)))
    .select('id')
    .single();
  if (error) throw error;
  clearCache(CACHE_KEY);
  return data.id as string;
};

export const getVehicles = async (): Promise<(Vehicle & { id: string })[]> => {
  const cached = await getCache<(Vehicle & { id: string })[]>(CACHE_KEY);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('registration_number', { ascending: true });
  if (error) throw error;
  const vehicles = (data ?? []).map(mapVehicleRow);
  setCache(CACHE_KEY, vehicles, TTL.MEDIUM);
  return vehicles;
};

export const updateVehicle = async (id: string, data: Partial<Vehicle>) => {
  const { error } = await supabase.from('vehicles').update(compactRow(toVehicleRow(data))).eq('id', id);
  if (error) throw error;
  clearCache(CACHE_KEY);
};

export const deleteVehicle = async (id: string) => {
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) throw error;
  clearCache(CACHE_KEY);
};
