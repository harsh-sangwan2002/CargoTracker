import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, Session, User } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
}

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { role: 'driver' } },
  });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  cachedUser = null;
};

export const reauthenticateWithPassword = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
};
