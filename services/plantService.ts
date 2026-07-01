import { supabase } from '../supabaseConfig';
import { getCache, setCache, clearCache, TTL } from '../utils/cache';

export interface Plant {
  id?: string;
  name: string;
  location?: string;
  createdAt?: any;
}

const CACHE_KEY = 'plants_all';

const mapPlantRow = (row: any): Plant & { id: string } => ({
  id: row.id,
  name: row.name ?? '',
  location: row.location ?? '',
  createdAt: row.created_at,
});

export const addPlant = async (plant: Omit<Plant, 'id' | 'createdAt'>) => {
  const { data, error } = await supabase
    .from('plants')
    .insert({ name: plant.name, location: plant.location || null })
    .select('id')
    .single();
  if (error) throw error;
  clearCache(CACHE_KEY);
  return data;
};

export const getPlants = async (): Promise<(Plant & { id: string })[]> => {
  const cached = await getCache<(Plant & { id: string })[]>(CACHE_KEY);
  if (cached) return cached;

  const { data, error } = await supabase.from('plants').select('*').order('name', { ascending: true });
  if (error) throw error;
  const plants = (data ?? []).map(mapPlantRow);
  setCache(CACHE_KEY, plants, TTL.LONG);
  return plants;
};

export const updatePlant = async (id: string, data: Partial<Plant>) => {
  const { error } = await supabase
    .from('plants')
    .update({ name: data.name, location: data.location || null })
    .eq('id', id);
  if (error) throw error;
  clearCache(CACHE_KEY);
};

export const deletePlant = async (id: string) => {
  const { error } = await supabase.from('plants').delete().eq('id', id);
  if (error) throw error;
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
