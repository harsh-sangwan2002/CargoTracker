import * as Location from 'expo-location';
import { updateDriverLocation, clearDriverTracking } from '../services/locationService';

// Live-location sharing lives at module level rather than in a screen, so it keeps
// running when the driver switches tabs (only the active tab is mounted) and there is
// never more than one position watcher at a time.

interface TrackedUser {
  uid: string;
  displayName: string | null;
  email: string | null;
}

let subscription: Location.LocationSubscription | null = null;
let starting: Promise<boolean> | null = null;
let trackedUser: TrackedUser | null = null;
let currentRoute: string | undefined;
const listeners = new Set<(tracking: boolean) => void>();

const notify = () => listeners.forEach(fn => fn(!!subscription));

export const isDriverTracking = () => !!subscription;

export const onDriverTrackingChange = (fn: (tracking: boolean) => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

// Resolves false if location permission is denied. Safe to call repeatedly: an
// already-running watcher is reused (only the route label is updated).
export const startDriverTracking = async (user: TrackedUser, route?: string): Promise<boolean> => {
  trackedUser = user;
  currentRoute = route;
  if (subscription) return true;
  if (starting) return starting;

  starting = (async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
      (pos) => {
        if (!trackedUser) return;
        updateDriverLocation(trackedUser.uid, {
          driverName: trackedUser.displayName || trackedUser.email || 'Driver',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          updatedAt: Date.now(),
          isTracking: true,
          tripRoute: currentRoute,
        }).catch(() => {});
      }
    );
    if (!trackedUser) {
      // stopped while we were waiting for permission
      sub.remove();
      return false;
    }
    subscription = sub;
    notify();
    return true;
  })().finally(() => { starting = null; });

  return starting;
};

export const stopDriverTracking = () => {
  const uid = trackedUser?.uid;
  subscription?.remove();
  subscription = null;
  trackedUser = null;
  currentRoute = undefined;
  notify();
  if (uid) clearDriverTracking(uid).catch(() => {});
};
