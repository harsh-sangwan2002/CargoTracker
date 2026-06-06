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
import { getCache, setCache, clearCache, TTL } from '../utils/cache';

export interface Plant {
  id?: string;
  name: string;
  location?: string;
  createdAt?: any;
}

const plantsRef = collection(db, 'plants');
const CACHE_KEY = 'plants_all';

export const addPlant = async (plant: Omit<Plant, 'id' | 'createdAt'>) => {
  const ref = await addDoc(plantsRef, { ...plant, createdAt: serverTimestamp() });
  clearCache(CACHE_KEY);
  return ref;
};

export const getPlants = async (): Promise<(Plant & { id: string })[]> => {
  const cached = await getCache<(Plant & { id: string })[]>(CACHE_KEY);
  if (cached) return cached;

  try {
    const q = query(plantsRef, orderBy('name', 'asc'));
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Plant & { id: string }));
    setCache(CACHE_KEY, data, TTL.LONG);
    return data;
  } catch {
    const snapshot = await getDocs(plantsRef);
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Plant & { id: string }));
    setCache(CACHE_KEY, data, TTL.LONG);
    return data;
  }
};

export const updatePlant = async (id: string, data: Partial<Plant>) => {
  await updateDoc(doc(db, 'plants', id), data);
  clearCache(CACHE_KEY);
};

export const deletePlant = async (id: string) => {
  await deleteDoc(doc(db, 'plants', id));
  clearCache(CACHE_KEY);
};

const DEFAULT_PLANTS = [
  'PTA terminal IOCL',
  'IVL Dhunseri',
  'Uflex Pvt limited',
  'Sanathan Textiles Mandi',
  'Aegios Poly films',
  'Polymer Terminal IOCL',
  'Meg Terminal IOCL',
  'BR Specialist',
];

export const seedDefaultPlantsIfEmpty = async () => {
  const existing = await getPlants();
  if (existing.length === 0) {
    for (const name of DEFAULT_PLANTS) {
      await addPlant({ name });
    }
  }
};
