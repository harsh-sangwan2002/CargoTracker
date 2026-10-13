import { File } from 'expo-file-system';
import { supabase } from '../supabaseConfig';

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
  const { data, error } = await supabase.from('profiles').update({ role }).eq('id', uid).select('role');
  if (error) throw error;
  // Only admins may change roles; RLS answers anyone else with 0 rows and no error.
  if (!data?.length || data[0].role !== role) throw new Error('Only admins can change user roles.');
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
// Columns full_name / phone / address on profiles (see supabase/schema.sql).

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
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: profile.fullName, phone: profile.phone, address: profile.address })
    .eq('id', uid)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Your profile could not be updated.');
};
