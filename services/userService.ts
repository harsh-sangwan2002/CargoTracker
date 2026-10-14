import { supabase } from '../supabaseConfig';

export interface UserProfile {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  isActive: boolean;
  createdAt?: any;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const mapUserRow = (row: any): UserProfile => ({
  uid: row.id,
  email: row.email,
  role: row.role,
  isActive: row.is_active !== false,
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

// RLS turns an unauthorised update into "0 rows updated" rather than an error,
// so confirm a row actually changed before reporting success.
const updateProfileAsAdmin = async (uid: string, changes: Record<string, unknown>) => {
  const { data, error } = await supabase.from('profiles').update(changes).eq('id', uid).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('You do not have permission to change this user.');
};

export const updateUserRole = async (uid: string, role: 'driver' | 'manager' | 'admin') =>
  updateProfileAsAdmin(uid, { role });

// Deactivated users keep their data but lose all access (enforced by RLS).
export const setUserActive = async (uid: string, isActive: boolean) =>
  updateProfileAsAdmin(uid, { is_active: isActive });

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

// ── Staff (admin/manager) extra profile ─────────────────────────────
// Users may update these columns on their own profile row (profiles_update_self);
// role / is_active are guarded server-side.

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

// Self-service account deletion. Runs server-side (delete_my_account) because
// RLS rightly stops users deleting rows they don't own: it removes the auth user,
// profile, notifications, live location and push token, and unlinks (but keeps)
// the employer's driver record and trip history.
export const deleteUserAccountData = async (_uid: string) => {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
};
