import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, Session, User } from '@supabase/supabase-js';
import { clearAllCache } from './utils/cache';
import { clearOfflineQueue, flushOfflineQueue } from './utils/offlineQueue';

// Supabase URL and anon/publishable key are safe to ship in the client bundle —
// they are not secrets; access control is enforced server-side via Row Level
// Security. Hardcoded here (with env override) so the app never depends on
// EXPO_PUBLIC_* vars being embedded correctly by every build path (some local/
// CI Android builds don't pick up .env, which previously crashed the app on
// launch with a blank screen).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://jlagdydxwxvjyyxxqykm.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_Cofh-Ejm0KSxrMSVqi7dWg_9dfA33gZ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export interface AppUser {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
}

const toAppUser = (user: User | null | undefined): AppUser | null => {
  if (!user) return null;
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  return {
    uid: user.id,
    id: user.id,
    email: user.email ?? null,
    displayName,
  };
};

let cachedUser: AppUser | null = null;

export const auth = {
  get currentUser() {
    return cachedUser;
  },
};

export const setCachedUserFromSession = (session: Session | null) => {
  cachedUser = toAppUser(session?.user);
  return cachedUser;
};

export const onAuthStateChanged = async (callback: (user: AppUser | null) => void) => {
  const { data } = await supabase.auth.getSession();
  callback(setCachedUserFromSession(data.session));

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(setCachedUserFromSession(session));
  });

  return () => listener.subscription.unsubscribe();
};

export const signInWithEmailAndPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setCachedUserFromSession(data.session);
  return data;
};

export const createUserWithEmailAndPassword = async (email: string, password: string) => {
  // Every new account is a driver; the role is assigned server-side (never from user_metadata).
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
};

// Cached trips/drivers and queued offline writes belong to the signed-in user, so they
// must not survive into the next session on this device.
export const signOut = async () => {
  // Replay anything done offline while this user's session is still valid.
  await flushOfflineQueue().catch(() => {});
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } finally {
    cachedUser = null;
    await Promise.all([clearAllCache(), clearOfflineQueue()]);
  }
};

// supabase-js only reports "non-2xx status code" for function errors; the real
// message is in the JSON body on error.context.
export const invokeFunction = async <T = any>(name: string, body?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const context = (error as any)?.context;
    if (context && typeof context.json === 'function') {
      const parsed = await context.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw error;
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
};

export const reauthenticateWithPassword = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
};

// Sends a 6-digit OTP by email through the password-otp-send edge function. The
// function responds the same way whether or not the email is registered.
export const sendOtp = async (email: string) => {
  await invokeFunction('password-otp-send', { email });
};

// Verifies the OTP and resets the password atomically via the password-otp-verify edge function.
// No active session is required — the edge function uses the service role to update the password.
export const resetPasswordWithOtp = async (email: string, otp: string, newPassword: string) => {
  await invokeFunction('password-otp-verify', { email, otp, newPassword });
};

// Permanently deletes the signed-in user's account (auth user + personal driver record)
// via the delete-account edge function, then signs out locally.
export const deleteAccount = async () => {
  await invokeFunction('delete-account');
  await signOut().catch(() => {});
};

// Used by ProfileScreen change-password (requires an active session).
export const updatePassword = async (newPassword: string) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
};
