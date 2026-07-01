import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabaseConfig';

export interface AppNotification {
  id: string;
  driverUserId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: any;
}

const mapNotificationRow = (row: any): AppNotification => ({
  id: row.id,
  driverUserId: row.driver_user_id,
  title: row.title,
  body: row.body,
  read: !!row.read,
  createdAt: row.created_at,
});

export const addNotification = async (n: {
  driverUserId: string;
  title: string;
  body: string;
}): Promise<void> => {
  const { error } = await supabase.from('notifications').insert({
    driver_user_id: n.driverUserId,
    title: n.title,
    body: n.body,
    read: false,
  });
  if (error) throw error;

  // Best-effort OS push in addition to the in-app notification row above; a driver
  // without a registered device (or if the function isn't deployed yet) still sees
  // the notification in-app, so failures here are intentionally swallowed.
  supabase.functions
    .invoke('send-push-notification', {
      body: { driverUserId: n.driverUserId, title: n.title, body: n.body },
    })
    .catch(() => {});
};

export const getDriverNotifications = async (
  driverUserId: string
): Promise<AppNotification[]> => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('driver_user_id', driverUserId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapNotificationRow);
  } catch {
    return [];
  }
};

export const markNotificationRead = async (id: string): Promise<void> => {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
};

export const markAllNotificationsRead = async (driverUserId: string): Promise<void> => {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('driver_user_id', driverUserId)
    .eq('read', false);
  if (error) throw error;
};

// Live-updates a driver's notification list (e.g. a new trip-assignment notice)
// without requiring a manual refresh.
export const subscribeToDriverNotifications = (
  driverUserId: string,
  callback: (notifications: AppNotification[]) => void
): (() => void) => {
  const refetch = async () => {
    callback(await getDriverNotifications(driverUserId));
  };

  const channel: RealtimeChannel = supabase
    .channel(`notifications-driver-${driverUserId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `driver_user_id=eq.${driverUserId}` },
      () => { refetch(); }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
};
