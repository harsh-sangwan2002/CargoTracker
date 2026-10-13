import { TripRecord } from './tripService';
import { Vehicle } from './vehicleService';
import { FuelLog } from './fuelService';

// trip id → total litres from its fuel logs
export type FuelByTrip = Map<string, number>;

export const fuelByTripFromLogs = (logs: FuelLog[]): FuelByTrip => {
  const map: FuelByTrip = new Map();
  for (const l of logs) {
    if (!l.tripId) continue;
    map.set(l.tripId, (map.get(l.tripId) ?? 0) + (Number(l.liters) || 0));
  }
  return map;
};

// Fuel for one trip: detailed fuel logs win when the trip has any (they're the
// record of every fill); otherwise the trip's quick-entry figure.
export const tripFuelLiters = (trip: TripRecord & { id: string }, fuelByTrip?: FuelByTrip): number => {
  const logged = fuelByTrip?.get(trip.id);
  if (logged !== undefined) return logged;
  return parseFloat(trip.fuelFilled ?? '0') || 0;
};

export const tripDistanceKm = (trip: TripRecord): number => parseFloat(trip.distanceTravelled ?? '0') || 0;

export interface VehicleStat {
  vehicleId: string;
  registrationNumber: string;
  trips: number;
  distanceKm: number;
  fuelLiters: number;
  kmPerLiter: number | null;
}

// Per-truck distance & fuel breakdown for a given (already date-range-filtered) set of trips.
export const vehicleStatsFromTrips = (
  trips: (TripRecord & { id: string })[],
  vehicles: (Vehicle & { id: string })[],
  fuelByTrip?: FuelByTrip
): VehicleStat[] => {
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const map = new Map<string, { trips: number; distanceKm: number; fuelLiters: number }>();

  for (const t of trips) {
    const key = t.vehicleId || t.truck || 'Unknown';
    const entry = map.get(key) ?? { trips: 0, distanceKm: 0, fuelLiters: 0 };
    entry.trips += 1;
    entry.distanceKm += tripDistanceKm(t);
    entry.fuelLiters += tripFuelLiters(t, fuelByTrip);
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({
      vehicleId: key,
      registrationNumber: vehicleById.get(key)?.registrationNumber ?? key,
      trips: v.trips,
      distanceKm: v.distanceKm,
      fuelLiters: v.fuelLiters,
      kmPerLiter: v.fuelLiters > 0 ? v.distanceKm / v.fuelLiters : null,
    }))
    .sort((a, b) => b.distanceKm - a.distanceKm);
};
