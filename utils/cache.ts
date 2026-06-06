import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'ct_cache:';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const TTL = {
  SHORT: 3 * 60 * 1000,   // 3 min — trips (change frequently)
  MEDIUM: 10 * 60 * 1000, // 10 min — drivers, users
  LONG: 30 * 60 * 1000,   // 30 min — plants (rarely change)
};

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expiresAt) {
      AsyncStorage.removeItem(PREFIX + key).catch(() => {});
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttl = TTL.SHORT): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttl };
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {}
}

export async function clearCache(...keys: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(keys.map(k => PREFIX + k));
  } catch {}
}

export async function clearCacheByPrefix(prefix: string): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const matched = all.filter(k => k.startsWith(PREFIX + prefix));
    if (matched.length) await AsyncStorage.multiRemove(matched);
  } catch {}
}
