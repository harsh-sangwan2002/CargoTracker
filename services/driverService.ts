import { supabase } from '../supabaseConfig';
import { getCache, setCache, clearCache, TTL } from '../utils/cache';

export interface Driver {
  fullName: string;
  age: number;
  address: string;
  aadhaarCard: string;
  panCard: string;
  vehicleOwned: string;
  photoUrl: string;
  userId: string;
  email?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  status?: 'active' | 'inactive' | 'suspended';
  createdAt?: any;
  updatedAt?: any;
}

const CACHE_KEY = 'drivers_all';

const cleanId = (value?: string) => value?.trim() ? value.trim() : null;

const mapDriverRow = (row: any): Driver & { id: string } => ({
  id: row.id,
  fullName: row.full_name || '',
  age: row.age || 0,
  address: row.address || '',
  aadhaarCard: row.aadhaar_number || '',
  panCard: row.pan_number || '',
  vehicleOwned: row.vehicle_owned || '',
  photoUrl: row.photo_path || '',
  userId: row.user_id || '',
  email: row.email || '',
  licenseNumber: row.license_number || '',
  licenseExpiry: row.license_expiry || '',
  status: row.status || 'active',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toDriverRow = (driver: Partial<Driver>) => ({
  full_name: driver.fullName,
  age: driver.age,
  address: driver.address,
  aadhaar_number: driver.aadhaarCard,
  pan_number: driver.panCard,
  vehicle_owned: driver.vehicleOwned,
  photo_path: driver.photoUrl,
  user_id: cleanId(driver.userId),
  email: driver.email !== undefined ? (driver.email.trim().toLowerCase() || null) : undefined,
  license_number: driver.licenseNumber,
  license_expiry: driver.licenseExpiry !== undefined ? (driver.licenseExpiry || null) : undefined,
  status: driver.status,
  updated_at: new Date().toISOString(),
});

const compactRow = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

// If a driver with the same email already exists, merge into that record instead of
// creating a duplicate — keeps the existing account link (userId) and profile_id intact
// so the driver's own Profile screen stays in sync with whatever the admin just entered.
export const addDriver = async (driver: Omit<Driver, 'createdAt' | 'updatedAt'>) => {
  const normalizedEmail = driver.email?.trim().toLowerCase();
  const existing = normalizedEmail ? await getDriverByEmail(normalizedEmail) : null;

  if (existing) {
    await updateDriver(existing.id, {
      ...driver,
      userId: existing.userId || driver.userId,
    });
    return existing.id;
  }

  const { data, error } = await supabase
    .from('drivers')
    .insert(compactRow(toDriverRow(driver)))
    .select('id')
    .single();
  if (error) throw error;
  clearCache(CACHE_KEY);
  return data.id as string;
};

export const getDrivers = async (userId?: string): Promise<(Driver & { id: string })[]> => {
  try {
    const cached = await getCache<(Driver & { id: string })[]>(CACHE_KEY);
    const all: (Driver & { id: string })[] = cached ?? await (async () => {
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const drivers = (data ?? []).map(mapDriverRow);
      setCache(CACHE_KEY, drivers, TTL.MEDIUM);
      return drivers;
    })();

    return userId ? all.filter(d => d.userId === userId) : all;
  } catch {
    return [];
  }
};

export const getDriverById = async (driverId: string): Promise<(Driver & { id: string }) | null> => {
  const { data, error } = await supabase.from('drivers').select('*').eq('id', driverId).maybeSingle();
  if (error) throw error;
  return data ? mapDriverRow(data) : null;
};

export const updateDriver = async (driverId: string, data: Partial<Driver>) => {
  const { error } = await supabase.from('drivers').update(compactRow(toDriverRow(data))).eq('id', driverId);
  if (error) throw error;
  clearCache(CACHE_KEY);
};

export const deleteDriver = async (driverId: string) => {
  const { error } = await supabase.from('drivers').delete().eq('id', driverId);
  if (error) throw error;
  clearCache(CACHE_KEY);
};

export const getDriverByUserId = async (uid: string): Promise<(Driver & { id: string }) | null> => {
  const { data, error } = await supabase.from('drivers').select('*').eq('user_id', uid).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapDriverRow(data) : null;
};

export const getDriverByEmail = async (email: string): Promise<(Driver & { id: string }) | null> => {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.from('drivers').select('*').eq('email', normalized).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapDriverRow(data) : null;
};

export const createDriverAccount = async (
  driverId: string,
  email: string,
  fullName?: string
): Promise<{ userId: string; email: string; tempPassword?: string; linkedExisting?: boolean }> => {
  const { data, error } = await supabase.functions.invoke('create-driver-user', {
    body: { driverId, email, fullName },
  });
  if (error) {
    // supabase-js only surfaces a generic "non-2xx status code" message here; the
    // actual reason is in the Edge Function's JSON response body on error.context.
    const context = (error as any)?.context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) throw new Error(body.error);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message) throw parsed;
      }
    }
    throw error;
  }
  clearCache(CACHE_KEY);
  return data;
};

export const linkDriverToUser = async (driverId: string, uid: string) => {
  // profile_id must be set alongside user_id — the drivers_select_own RLS policy
  // gates a driver's own read access on profile_id = auth.uid(), not user_id.
  // Without it, the driver's own record becomes permanently invisible to them.
  const { error } = await supabase
    .from('drivers')
    .update({ user_id: uid, profile_id: uid, updated_at: new Date().toISOString() })
    .eq('id', driverId);
  if (error) throw error;
  clearCache(CACHE_KEY);
};
