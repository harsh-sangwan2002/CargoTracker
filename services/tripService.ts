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

export const addTrip = async (trip: Omit<TripFirestore, 'createdAt'>) => {
  await addDoc(tripsRef, {
    ...trip,
    createdAt: serverTimestamp(),
  });
};

export const getTrips = async () => {
  const q = query(tripsRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      ...data,
      departureTime: data.departureTime?.toDate(),
      arrivalTime: data.arrivalTime?.toDate() || null,
    };
  }) as (TripFirestore & { id: string })[];
};

export const updateTrip = async (
  id: string,
  data: Partial<TripFirestore>
) => {
  const ref = doc(db, 'trips', id);
  await updateDoc(ref, data);
};

export const deleteTrip = async (id: string) => {
  const ref = doc(db, 'trips', id);
  await deleteDoc(ref);
};
