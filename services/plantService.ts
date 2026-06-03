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

export interface Plant {
  id?: string;
  name: string;
  location?: string;
  createdAt?: any;
}

const plantsRef = collection(db, 'plants');

export const addPlant = async (plant: Omit<Plant, 'id' | 'createdAt'>) => {
  return addDoc(plantsRef, { ...plant, createdAt: serverTimestamp() });
};

export const getPlants = async (): Promise<(Plant & { id: string })[]> => {
  try {
    const q = query(plantsRef, orderBy('name', 'asc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Plant & { id: string }));
  } catch {
    const snapshot = await getDocs(plantsRef);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Plant & { id: string }));
  }
};

export const updatePlant = async (id: string, data: Partial<Plant>) => {
  await updateDoc(doc(db, 'plants', id), data);
};

export const deletePlant = async (id: string) => {
  await deleteDoc(doc(db, 'plants', id));
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
