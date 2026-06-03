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

export const addTrip = async (trip: Omit<TripFirestore, 'createdAt'>) => {
  await addDoc(tripsRef, {
    ...trip,
    createdAt: serverTimestamp(),
  });
};

export const getTrips = async (): Promise<(TripFirestore & { id: string })[]> => {
  const q = query(tripsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc);
};

export const getTripsByUser = async (userId: string): Promise<(TripFirestore & { id: string })[]> => {
  const q = query(tripsRef, where('userId', '==', userId), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(mapDoc);
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
  const ref = doc(db, 'trips', id);
  await updateDoc(ref, data);
};

export const deleteTrip = async (id: string) => {
  const ref = doc(db, 'trips', id);
  await deleteDoc(ref);
};
