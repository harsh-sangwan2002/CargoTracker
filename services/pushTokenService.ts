import { supabase } from '../supabaseConfig';

export const registerPushToken = async (userId: string, expoPushToken: string) => {
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, expo_push_token: expoPushToken, updated_at: new Date().toISOString() });
  if (error) throw error;
};
