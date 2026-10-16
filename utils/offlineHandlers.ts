import { registerOfflineHandler } from './offlineQueue';
import { startTrip, endTrip } from '../services/tripService';
import { addFuelLog } from '../services/fuelService';

// Registered once at app start (App.tsx) so queued ops replay regardless of which
// screen is mounted. Replayed writes are timestamped with when the driver actually
// tapped (effectiveNow() in offlineQueue), not when connectivity came back.
export const registerDefaultOfflineHandlers = () => {
  registerOfflineHandler('startTrip', async (p) => { await startTrip(p.tripId, { odometerStart: p.odometerStart }); });
  registerOfflineHandler('endTrip', async (p) => { await endTrip(p.tripId, { odometerEnd: p.odometerEnd }); });
  registerOfflineHandler('addFuelLog', async (p) => { await addFuelLog(p); });
};
