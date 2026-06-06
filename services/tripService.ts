import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { getCache, setCache, clearCacheByPrefix, TTL } from '../utils/cache';

export interface TripFirestore {
  truck: string;
  bidNo: string;
  driverName: string;
  companyName: string;
  itemType: string;
  quantity: string;
  fuelFilled: string;
  distanceTravelled?: string;
  departureTime: Date;
  arrivalTime: Date | null;
  fromPlant: string;
  toPlant: string;
  status: string;
  time: string;
  userId?: string;
  driverUserId?: string;
  createdAt: any;
}

const tripsRef = collection(db, 'trips');

const mapDoc = (docSnap: any): TripFirestore & { id: string } => {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    ...data,
    departureTime: data.departureTime?.toDate?.() ?? new Date(data.departureTime),
    arrivalTime: data.arrivalTime?.toDate?.() ?? null,
  };
};

// Revive Date strings from JSON cache back to Date objects
const reviveTrip = (raw: any): TripFirestore & { id: string } => ({
  ...raw,
  departureTime: raw.departureTime ? new Date(raw.departureTime) : new Date(0),
  arrivalTime: raw.arrivalTime ? new Date(raw.arrivalTime) : null,
});

const invalidateTripCache = () => clearCacheByPrefix('trips_');

export const addTrip = async (trip: Omit<TripFirestore, 'createdAt'>) => {
  await addDoc(tripsRef, { ...trip, createdAt: serverTimestamp() });
  await invalidateTripCache();
};

export const getTrips = async (): Promise<(TripFirestore & { id: string })[]> => {
  const cached = await getCache<any[]>('trips_all');
  if (cached) return cached.map(reviveTrip);

  const q = query(tripsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  const data = snapshot.docs.map(mapDoc);
  setCache('trips_all', data, TTL.SHORT);
  return data;
};

export const getTripsByUser = async (driverUid: string): Promise<(TripFirestore & { id: string })[]> => {
  const key = `trips_user_${driverUid}`;
  const cached = await getCache<any[]>(key);
  if (cached) return cached.map(reviveTrip);

  // Query by driverUserId (trips assigned by admin/manager to this driver)
  const snap = await getDocs(query(tripsRef, where('driverUserId', '==', driverUid)));
  const data = snap.docs
    .map(mapDoc)
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  setCache(key, data, TTL.SHORT);
  return data;
};

export const getTripsByDateRange = async (
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<(TripFirestore & { id: string })[]> => {
  const start = Timestamp.fromDate(startDate);
  const end = Timestamp.fromDate(endDate);

  let q;
  if (userId) {
    q = query(
      tripsRef,
      where('userId', '==', userId),
      where('createdAt', '>=', start),
      where('createdAt', '<=', end),
      orderBy('createdAt', 'desc')
    );
  } else {
    q = query(
      tripsRef,
      where('createdAt', '>=', start),
      where('createdAt', '<=', end),
      orderBy('createdAt', 'desc')
    );
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc);
};

export const updateTrip = async (id: string, data: Partial<TripFirestore>) => {
  await updateDoc(doc(db, 'trips', id), data);
  await invalidateTripCache();
};

export const startTrip = async (id: string) => {
  await updateDoc(doc(db, 'trips', id), { departureTime: new Date(), status: 'active' });
  await invalidateTripCache();
};

export const endTrip = async (id: string) => {
  await updateDoc(doc(db, 'trips', id), { arrivalTime: new Date(), status: 'completed' });
  await invalidateTripCache();
};

export const deleteTrip = async (id: string) => {
  await deleteDoc(doc(db, 'trips', id));
  await invalidateTripCache();
};
