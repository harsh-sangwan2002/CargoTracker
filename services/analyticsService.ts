import { TripRecord } from './tripService';
import { Vehicle } from './vehicleService';

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
  vehicles: (Vehicle & { id: string })[]
): VehicleStat[] => {
  const vehicleById = new Map(vehicles.map(v => [v.id, v]));
  const map = new Map<string, { trips: number; distanceKm: number; fuelLiters: number }>();

  for (const t of trips) {
    const key = t.vehicleId || t.truck || 'Unknown';
    const entry = map.get(key) ?? { trips: 0, distanceKm: 0, fuelLiters: 0 };
    entry.trips += 1;
    entry.distanceKm += parseFloat(t.distanceTravelled ?? '0') || 0;
    entry.fuelLiters += parseFloat(t.fuelFilled ?? '0') || 0;
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
