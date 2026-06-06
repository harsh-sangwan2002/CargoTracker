import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface AppNotification {
  id: string;
  driverUserId: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: any;
}

const notifRef = collection(db, 'notifications');

export const addNotification = async (n: {
  driverUserId: string;
  title: string;
  body: string;
}): Promise<void> => {
  await addDoc(notifRef, { ...n, read: false, createdAt: serverTimestamp() });
};

export const getDriverNotifications = async (
  driverUserId: string
): Promise<AppNotification[]> => {
  try {
    const snap = await getDocs(
      query(notifRef, where('driverUserId', '==', driverUserId))
    );
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification));
    return items.sort((a, b) => {
      const ta = a.createdAt?.seconds ?? 0;
      const tb = b.createdAt?.seconds ?? 0;
      return tb - ta;
    });
  } catch {
    return [];
  }
};

export const markNotificationRead = async (id: string): Promise<void> => {
  await updateDoc(doc(db, 'notifications', id), { read: true });
};

export const markAllNotificationsRead = async (driverUserId: string): Promise<void> => {
  const snap = await getDocs(
    query(notifRef, where('driverUserId', '==', driverUserId), where('read', '==', false))
  );
  await Promise.all(snap.docs.map(d => updateDoc(d.ref, { read: true })));
};
