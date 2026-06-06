import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { getCache, setCache, clearCache, TTL } from '../utils/cache';

export interface Driver {
  fullName: string;
  age: number;
  address: string;
  aadhaarCard: string;
  panCard: string;
  vehicleOwned: string;
  photoUrl: string;
  userId: string;
  createdAt?: any;
  updatedAt?: any;
}

const driversRef = collection(db, 'drivers');
const CACHE_KEY = 'drivers_all';

export const addDriver = async (driver: Omit<Driver, 'createdAt' | 'updatedAt'>) => {
  const docRef = await addDoc(driversRef, {
    ...driver,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  clearCache(CACHE_KEY);
  return docRef.id;
};

export const getDrivers = async (userId?: string): Promise<(Driver & { id: string })[]> => {
  try {
    const cached = await getCache<(Driver & { id: string })[]>(CACHE_KEY);
    const all: (Driver & { id: string })[] = cached ?? await (async () => {
      const snapshot = await getDocs(driversRef);
      const drivers = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          fullName: data.fullName || '',
          age: data.age || 0,
          address: data.address || '',
          aadhaarCard: data.aadhaarCard || '',
          panCard: data.panCard || '',
          vehicleOwned: data.vehicleOwned || '',
          photoUrl: data.photoUrl || '',
          userId: data.userId || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        } as Driver & { id: string };
      });
      setCache(CACHE_KEY, drivers, TTL.MEDIUM);
      return drivers;
    })();

    return userId ? all.filter(d => d.userId === userId) : all;
  } catch {
    return [];
  }
};

export const getDriverById = async (driverId: string): Promise<(Driver & { id: string }) | null> => {
  const all = await getDrivers();
  return all.find(d => d.id === driverId) ?? null;
};

export const updateDriver = async (driverId: string, data: Partial<Driver>) => {
  await updateDoc(doc(db, 'drivers', driverId), { ...data, updatedAt: serverTimestamp() });
  clearCache(CACHE_KEY);
};

export const deleteDriver = async (driverId: string) => {
  await deleteDoc(doc(db, 'drivers', driverId));
  clearCache(CACHE_KEY);
};
