import { File } from 'expo-file-system';
import { supabase } from '../supabaseConfig';
import { getDrivers } from './driverService';

export interface UserProfile {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  createdAt?: any;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const mapUserRow = (row: any): UserProfile => ({
  uid: row.id,
  email: row.email,
  role: row.role,
  createdAt: row.created_at,
});

export const createUserProfile = async (
  uid: string,
  email: string,
  role: 'driver' | 'manager' | 'admin' = 'driver'
) => {
  const { error } = await supabase.from('profiles').upsert({
    id: uid,
    email: normalizeEmail(email),
    role,
  });
  if (error) throw error;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  return data ? mapUserRow(data) : null;
};

export const getUsers = async (): Promise<UserProfile[]> => {
  const { data, error } = await supabase.from('profiles').select('*').order('email', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapUserRow);
};

export const getUserByEmail = async (email: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', normalizeEmail(email))
    .maybeSingle();
  if (error) throw error;
  return data ? mapUserRow(data) : null;
};

export const updateUserRole = async (uid: string, role: 'driver' | 'manager' | 'admin') => {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', uid);
  if (error) throw error;
};

export const isManager = async (uid: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(uid);
    return profile?.role === 'manager' || profile?.role === 'admin';
  } catch {
    return false;
  }
};

export const isAdmin = async (uid: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(uid);
    return profile?.role === 'admin';
  } catch {
    return false;
  }
};

export const convertImageToBase64 = async (imageUri: string): Promise<string> => {
  try {
    if (!imageUri || imageUri.startsWith('data:') || imageUri.startsWith('http')) {
      return imageUri;
    }

    const imageFile = new File(imageUri);
    const base64 = await imageFile.base64();
    const imageType = imageUri.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    return `data:image/${imageType};base64,${base64}`;
  } catch {
    return imageUri;
  }
};

// ── Staff (admin/manager) extra profile ─────────────────────────────
// Requires these columns on the profiles table (run once in Supabase SQL editor):
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
//   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address TEXT;

export interface StaffProfile {
  fullName: string;
  phone: string;
  address: string;
}

export const getStaffProfile = async (uid: string): Promise<StaffProfile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, phone, address')
    .eq('id', uid)
    .maybeSingle();
  if (error || !data) return null;
  return {
    fullName: data.full_name ?? '',
    phone: data.phone ?? '',
    address: data.address ?? '',
  };
};

export const upsertStaffProfile = async (uid: string, profile: StaffProfile) => {
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: profile.fullName, phone: profile.phone, address: profile.address })
    .eq('id', uid);
  if (error) throw error;
};

// ── Seed test manager accounts ───────────────────────────────────────
// Requires email confirmation to be disabled in Supabase Auth settings,
// or the accounts can be confirmed manually via the Supabase dashboard.
const TEST_MANAGERS = [
  { email: 'manager1@cargotracker.com', password: 'Manager@123', name: 'Priya Sharma' },
  { email: 'manager2@cargotracker.com', password: 'Manager@123', name: 'Rahul Verma' },
];

export const seedManagerAccounts = async (): Promise<{ email: string; status: string }[]> => {
  const results: { email: string; status: string }[] = [];
  for (const m of TEST_MANAGERS) {
    try {
      const { data, error } = await supabase.auth.signUp({ email: m.email, password: m.password });
      if (error) {
        if (error.message?.toLowerCase().includes('already registered')) {
          results.push({ email: m.email, status: 'already exists' });
        } else {
          results.push({ email: m.email, status: `failed: ${error.message}` });
        }
        continue;
      }
      const uid = data.user?.id;
      if (uid) {
        await supabase.from('profiles').upsert({ id: uid, email: m.email, role: 'manager', full_name: m.name });
      }
      results.push({ email: m.email, status: 'created' });
    } catch (e: any) {
      results.push({ email: m.email, status: `error: ${e.message}` });
    }
  }
  return results;
};

export const deleteUserAccountData = async (uid: string) => {
  const driversList = await getDrivers(uid);
  const driverIds = driversList.map(d => d.id);

  const results = await Promise.all([
    supabase.from('notifications').delete().eq('driver_user_id', uid),
    supabase.from('driver_locations').delete().eq('user_id', uid),
    supabase.from('trips').delete().or(`user_id.eq.${uid},driver_user_id.eq.${uid}`),
    driverIds.length
      ? supabase.from('drivers').delete().in('id', driverIds)
      : Promise.resolve({ error: null }),
  ]);
  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;

  const { error } = await supabase.from('profiles').delete().eq('id', uid);
  if (error) throw error;
};
