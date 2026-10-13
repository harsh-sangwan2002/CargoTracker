import { registerOfflineHandler } from './offlineQueue';
import { startTrip, endTrip } from '../services/tripService';
import { addFuelLog } from '../services/fuelService';

// Payloads carry `at` (ISO time the driver actually tapped the button) so a trip
// started/ended offline is recorded with that time, not the time it synced.
const atOf = (payload: any) => (payload?.at ? new Date(payload.at) : undefined);

// Registered once at app start (App.tsx) so queued ops replay regardless of which
// screen is mounted.
export const registerDefaultOfflineHandlers = () => {
  registerOfflineHandler('startTrip', async (p) => { await startTrip(p.tripId, atOf(p)); });
  registerOfflineHandler('endTrip', async (p) => { await endTrip(p.tripId, atOf(p)); });
  registerOfflineHandler('addFuelLog', async (p) => { await addFuelLog(p); });
};
