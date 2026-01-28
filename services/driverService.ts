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
    console.log('📝 Adding driver:', driver);
    const docRef = await addDoc(driversRef, {
      ...driver,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log('✅ Driver added with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error adding driver:', error);
    throw error;
  }
};

export const getDrivers = async (userId?: string) => {
  try {
    console.log('🔍 Starting getDrivers - userId:', userId);
    
    // Get all drivers without any complex queries
    console.log('📡 Calling getDocs on driversRef...');
    const snapshot = await getDocs(driversRef);
    
    console.log('📦 Snapshot received, total docs:', snapshot.docs.length);

    const drivers = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        fullName: data.fullName || '',
        age: data.age || 0,
        address: data.address || '',
        aadhaarCard: data.aadhaarCard || '',
        panCard: data.panCard || '',
        photoUrl: data.photoUrl || '',
        userId: data.userId || '',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    }) as (Driver & { id: string })[];

    console.log('✅ Total drivers:', drivers.length);

    // Filter by userId if provided
    if (userId) {
      const filtered = drivers.filter(d => d.userId === userId);
      console.log(`🔎 Filtered by userId: ${drivers.length} -> ${filtered.length}`);
      return filtered;
    }

    return drivers;
  } catch (error: any) {
    console.error('❌ ERROR in getDrivers:', {
      message: error.message,
      code: error.code,
    });
    return [];
  }
};

export const getDriverById = async (driverId: string) => {
  try {
    const docRef = doc(db, 'drivers', driverId);
    const snapshot = await getDocs(driversRef);
    const driverDoc = snapshot.docs.find(doc => doc.id === driverId);
    
    if (driverDoc) {
      const data = driverDoc.data();
      if (data) {
        return {
          id: driverDoc.id,
          ...data,
        } as Driver & { id: string };
      }
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
