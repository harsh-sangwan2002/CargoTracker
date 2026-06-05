import { db } from '../firebaseConfig';
import { doc, setDoc, collection, onSnapshot } from 'firebase/firestore';

export interface DriverLocation {
  userId: string;
  driverName: string;
  lat: number;
  lng: number;
  updatedAt: number;
  isTracking: boolean;
  tripRoute?: string;
}

export const updateDriverLocation = (userId: string, data: Omit<DriverLocation, 'userId'>) =>
  setDoc(doc(db, 'driverLocations', userId), { ...data, userId }, { merge: true });

export const clearDriverTracking = (userId: string) =>
  setDoc(doc(db, 'driverLocations', userId), { isTracking: false, updatedAt: Date.now() }, { merge: true });

export const subscribeToActiveLocations = (callback: (locs: DriverLocation[]) => void) =>
  onSnapshot(collection(db, 'driverLocations'), (snap) => {
    callback(snap.docs.map(d => d.data() as DriverLocation).filter(l => l.isTracking));
  });
