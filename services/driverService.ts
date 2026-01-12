import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

export interface Driver {
  fullName: string;
  age: number;
  address: string;
  aadhaarCard: string;
  panCard: string;
  photoUrl: string;
  userId: string;
  createdAt?: any;
  updatedAt?: any;
}

const driversRef = collection(db, 'drivers');

export const addDriver = async (driver: Omit<Driver, 'createdAt' | 'updatedAt'>) => {
  try {
    const docRef = await addDoc(driversRef, {
      ...driver,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error('Error adding driver:', error);
    throw error;
  }
};

export const getDrivers = async (userId?: string) => {
  try {
    let q;
    if (userId) {
      q = query(
        driversRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
    } else {
      q = query(driversRef, orderBy('createdAt', 'desc'));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as (Driver & { id: string })[];
  } catch (error) {
    console.error('Error getting drivers:', error);
    throw error;
  }
};

export const getDriverById = async (driverId: string) => {
  try {
    const docRef = doc(db, 'drivers', driverId);
    const snapshot = await getDocs(query(driversRef));
    const driverDoc = snapshot.docs.find(doc => doc.id === driverId);
    
    if (driverDoc) {
      return {
        id: driverDoc.id,
        ...driverDoc.data(),
      } as Driver & { id: string };
    }
    return null;
  } catch (error) {
    console.error('Error getting driver:', error);
    throw error;
  }
};

export const updateDriver = async (
  driverId: string,
  data: Partial<Driver>
) => {
  try {
    const ref = doc(db, 'drivers', driverId);
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating driver:', error);
    throw error;
  }
};

export const deleteDriver = async (driverId: string) => {
  try {
    const ref = doc(db, 'drivers', driverId);
    await deleteDoc(ref);
  } catch (error) {
    console.error('Error deleting driver:', error);
    throw error;
  }
};
