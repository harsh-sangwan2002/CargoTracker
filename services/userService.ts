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
