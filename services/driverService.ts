import { File } from 'expo-file-system';
import { supabase, invokeFunction } from '../supabaseConfig';
import { getCache, setCache, clearCache, TTL } from '../utils/cache';
import { base64ToBytes } from '../utils/base64';

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

// Every drivers column the app roles may read. Aadhaar/PAN are column-restricted
// in Postgres (admins read them via getDriverPii), so `select *` is refused.
const DRIVER_COLUMNS =
  'id, full_name, age, address, vehicle_owned, photo_path, user_id, email, created_at, updated_at, ' +
  'profile_id, license_number, license_expiry, status, created_by';

export const PHOTO_BUCKET = 'driver-photos';

// Shown in place of Aadhaar/PAN to anyone who can't read them.
export const maskId = (value?: string, visible = 4) => {
  const v = (value ?? '').replace(/\s/g, '');
  if (!v) return '';
  return v.length <= visible ? v : `${'•'.repeat(v.length - visible)}${v.slice(-visible)}`;
};

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
  // Only sent when provided: managers can't read PII, so their edits never
  // include it and must not blank out what an admin entered.
  aadhaar_number: driver.aadhaarCard?.trim() ? driver.aadhaarCard.trim() : undefined,
  pan_number: driver.panCard?.trim() ? driver.panCard.trim().toUpperCase() : undefined,
  vehicle_owned: driver.vehicleOwned,
  photo_path: driver.photoUrl,
  user_id: driver.userId !== undefined ? cleanId(driver.userId) : undefined,
  email: driver.email !== undefined ? (driver.email.trim().toLowerCase() || null) : undefined,
  license_number: driver.licenseNumber,
  license_expiry: driver.licenseExpiry !== undefined ? (driver.licenseExpiry || null) : undefined,
  status: driver.status,
});

const compactRow = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

// If a driver with the same email already exists, merge into that record instead of
// creating a duplicate — keeps the existing account link (userId) and profile_id intact
// so the driver's own Profile screen stays in sync with whatever the admin just entered.
export const addDriver = async (
  driver: Omit<Driver, 'createdAt' | 'updatedAt' | 'photoUrl' | 'userId'> & Partial<Pick<Driver, 'photoUrl' | 'userId'>>
) => {
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
        .select(DRIVER_COLUMNS)
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
  const { data, error } = await supabase.from('drivers').select(DRIVER_COLUMNS).eq('id', driverId).maybeSingle();
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
  const { data, error } = await supabase.from('drivers').select(DRIVER_COLUMNS).eq('user_id', uid).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapDriverRow(data) : null;
};

export const getDriverByEmail = async (email: string): Promise<(Driver & { id: string }) | null> => {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.from('drivers').select(DRIVER_COLUMNS).eq('email', normalized).limit(1).maybeSingle();
  if (error) throw error;
  return data ? mapDriverRow(data) : null;
};

export const createDriverAccount = async (
  driverId: string,
  email: string,
  fullName?: string
): Promise<{ userId: string; email: string; tempPassword?: string; linkedExisting?: boolean }> => {
  const data = await invokeFunction('create-driver-user', { driverId, email, fullName });
  clearCache(CACHE_KEY);
  return data;
};

// ── PII (admin, or the driver themselves) ─────────────────────────────────
export const getDriverPii = async (driverId: string): Promise<{ aadhaarCard: string; panCard: string } | null> => {
  const { data, error } = await supabase.rpc('get_driver_pii', { p_driver_id: driverId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? { aadhaarCard: row.aadhaar_number ?? '', panCard: row.pan_number ?? '' } : null;
};

// ── Driver self-service ───────────────────────────────────────────────────
// Links an unlinked admin-created record with the driver's (confirmed) email,
// then returns the driver's own record including their own PII.
export const getMyDriverProfile = async (): Promise<(Driver & { id: string }) | null> => {
  await supabase.rpc('claim_my_driver_record');
  const { data, error } = await supabase.rpc('get_my_driver_profile');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapDriverRow(row) : null;
};

export const saveMyDriverProfile = async (profile: {
  fullName: string;
  age: number;
  address: string;
  aadhaarCard: string;
  panCard: string;
}): Promise<string> => {
  const { data, error } = await supabase.rpc('save_my_driver_profile', {
    p_full_name: profile.fullName,
    p_age: profile.age,
    p_address: profile.address,
    p_aadhaar: profile.aadhaarCard.replace(/\s/g, ''),
    p_pan: profile.panCard.toUpperCase(),
  });
  if (error) throw error;
  clearCache(CACHE_KEY);
  return data as string;
};

// ── Photos (private Storage bucket, served via short-lived signed URLs) ────
const isInlineOrRemote = (value: string) => value.startsWith('data:') || /^https?:\/\//.test(value);

export const isLocalImageUri = (value?: string) =>
  !!value && /^(file|content|ph|assets-library):/.test(value);

export const uploadDriverPhoto = async (driverId: string, localUri: string): Promise<string> => {
  const isPng = localUri.toLowerCase().endsWith('.png');
  const bytes = base64ToBytes(await new File(localUri).base64());
  const path = `${driverId}/${Date.now()}.${isPng ? 'png' : 'jpg'}`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: isPng ? 'image/png' : 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
};

// Saves a newly picked photo for a driver and points the record at it; the
// previous object is removed so old photos don't linger in the bucket.
export const setDriverPhoto = async (driverId: string, localUri: string, previousPath?: string) => {
  const path = await uploadDriverPhoto(driverId, localUri);
  await updateDriver(driverId, { photoUrl: path });
  if (previousPath && !isInlineOrRemote(previousPath) && previousPath !== path) {
    supabase.storage.from(PHOTO_BUCKET).remove([previousPath]).catch(() => {});
  }
  return path;
};

// Resolves stored photo references to displayable URIs. Storage paths become
// signed URLs (1 hour); legacy base64 data URLs and http URLs pass through.
export const resolveDriverPhotoUrls = async (photoPaths: string[]): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const storagePaths = Array.from(new Set(photoPaths.filter(p => p && !isInlineOrRemote(p) && !isLocalImageUri(p))));
  photoPaths.forEach(p => { if (p && (isInlineOrRemote(p) || isLocalImageUri(p))) out[p] = p; });
  if (!storagePaths.length) return out;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(storagePaths, 60 * 60);
  if (error) return out;
  (data ?? []).forEach(item => {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  });
  return out;
};
