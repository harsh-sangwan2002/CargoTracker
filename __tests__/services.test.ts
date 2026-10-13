// Service-layer regression tests. The Supabase client is replaced with a recorder
// that captures every query-builder call and returns canned results per table.

type Op = [string, any[]];
interface MockCall { table: string; ops: Op[] }

const mockCalls: MockCall[] = [];
// table → result, or a function of the recorded call (e.g. to page by .range()).
let mockResults: Record<string, any> = {};
let mockRpc: Record<string, any> = {};

jest.mock('../supabaseConfig', () => {
  const makeBuilder = (table: string) => {
    const call: MockCall = { table, ops: [] };
    mockCalls.push(call);
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const r = mockResults[table];
          const result = typeof r === 'function' ? r(call) : (r ?? { data: [], error: null });
          return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        }
        return (...args: any[]) => { call.ops.push([String(prop), args]); return proxy; };
      },
    });
    return proxy;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      rpc: (name: string) => Promise.resolve(mockRpc[name] ?? { data: null, error: null }),
      functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) },
    },
    auth: { currentUser: null },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockOnline = true;
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(() => Promise.resolve({ isConnected: mockOnline, isInternetReachable: mockOnline })),
}));

jest.mock('expo-file-system', () => ({ File: class {} }), { virtual: true });

const opArgs = (call: MockCall, name: string) => call.ops.find(([n]) => n === name)?.[1];
const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  mockCalls.length = 0;
  mockResults = {};
  mockRpc = {};
  mockOnline = true;
  jest.resetModules();
});

describe('trips', () => {
  it('reads the odometer-computed distance_travelled_km, not the legacy text column', async () => {
    mockResults.trips = {
      data: [{
        id: 't1', truck: 'HR55AB1234', vehicle_id: 'v1', departure_time: new Date().toISOString(),
        distance_travelled: '0', distance_travelled_km: 250, fuel_filled: '40', fuel_filled_liters: 40,
      }],
      error: null,
    };
    const { getTrips } = require('../services/tripService');
    const { vehicleStatsFromTrips } = require('../services/analyticsService');
    const trips = await getTrips();
    expect(trips[0].distanceTravelled).toBe('250');
    const [stat] = vehicleStatsFromTrips(trips, [{ id: 'v1', registrationNumber: 'HR55AB1234' }]);
    expect(stat.distanceKm).toBe(250);
    expect(stat.kmPerLiter).toBeCloseTo(6.25);
  });

  it('falls back to the legacy text columns for old rows', async () => {
    mockResults.trips = {
      data: [{ id: 't1', departure_time: new Date().toISOString(), distance_travelled: '120', fuel_filled: '30' }],
      error: null,
    };
    const { getTrips } = require('../services/tripService');
    const [trip] = await getTrips();
    expect(trip.distanceTravelled).toBe('120');
    expect(trip.fuelFilled).toBe('30');
  });

  it('pages through more than 1000 trips instead of stopping at the API row cap', async () => {
    const row = (i: number) => ({ id: `t${i}`, departure_time: new Date().toISOString() });
    mockResults.trips = (call: MockCall) => {
      const [from] = opArgs(call, 'range')!;
      const n = from === 0 ? 1000 : from === 1000 ? 1000 : 7;
      return { data: Array.from({ length: n }, (_, i) => row(from + i)), error: null };
    };
    const { getTrips } = require('../services/tripService');
    expect(await getTrips()).toHaveLength(2007);
  });

  it('a partial update does not clear arrival_time', async () => {
    const { updateTrip } = require('../services/tripService');
    await updateTrip('t1', { companyName: 'X' });
    const payload = opArgs(mockCalls.find(c => c.table === 'trips')!, 'update')![0];
    expect('arrival_time' in payload).toBe(false);
  });

  it('isTripStarted only treats driver-started trips as running', () => {
    const { isTripStarted } = require('../services/tripService');
    expect(isTripStarted({ status: 'active', arrivalTime: null })).toBe(true);
    expect(isTripStarted({ status: 'Active', arrivalTime: null })).toBe(false); // legacy "assigned"
    expect(isTripStarted({ status: 'pending', arrivalTime: null })).toBe(false);
    expect(isTripStarted({ status: 'active', arrivalTime: new Date() })).toBe(false);
  });
});

describe('partial updates only touch the fields being changed', () => {
  it('editing a driver keeps their account link (user_id)', async () => {
    mockResults.drivers = { data: [{ id: 'd1' }], error: null };
    const { updateDriver } = require('../services/driverService');
    await updateDriver('d1', { fullName: 'X', age: 30 });
    const payload = opArgs(mockCalls.find(c => c.table === 'drivers')!, 'update')![0];
    expect('user_id' in payload).toBe(false);
  });

  it('editing a trip keeps its creator and other links', async () => {
    const { updateTrip } = require('../services/tripService');
    await updateTrip('t1', { driverUserId: 'u2', driverId: 'd2' });
    const payload = opArgs(mockCalls.find(c => c.table === 'trips')!, 'update')![0];
    expect(payload).toMatchObject({ driver_user_id: 'u2', driver_id: 'd2' });
    for (const k of ['user_id', 'vehicle_id', 'from_plant_id', 'to_plant_id']) expect(k in payload).toBe(false);
  });

  it('editing a vehicle does not wipe fields that were not edited', async () => {
    const { updateVehicle } = require('../services/vehicleService');
    await updateVehicle('v1', { status: 'retired' });
    const payload = opArgs(mockCalls.find(c => c.table === 'vehicles')!, 'update')![0];
    for (const k of ['type', 'capacity_tons', 'fuel_type']) expect(k in payload).toBe(false);
  });
});

describe('analytics fuel', () => {
  it('uses fuel logs for a trip when it has any, else the quick-entry figure', () => {
    const { fuelByTripFromLogs, tripFuelLiters } = require('../services/analyticsService');
    const byTrip = fuelByTripFromLogs([
      { tripId: 't1', vehicleId: 'v', liters: 20 },
      { tripId: 't1', vehicleId: 'v', liters: 15 },
      { vehicleId: 'v', liters: 99 }, // not tied to a trip
    ]);
    expect(tripFuelLiters({ id: 't1', fuelFilled: '40' }, byTrip)).toBe(35);
    expect(tripFuelLiters({ id: 't2', fuelFilled: '40' }, byTrip)).toBe(40);
  });
});

describe('writes blocked by RLS are reported, not silently "saved"', () => {
  it('updateDriver throws when no row was updated', async () => {
    mockResults.drivers = { data: [], error: null };
    const { updateDriver } = require('../services/driverService');
    await expect(updateDriver('d1', { fullName: 'X' })).rejects.toThrow(/permission/);
  });

  it('updateUserRole throws when no row was updated', async () => {
    mockResults.profiles = { data: [], error: null };
    const { updateUserRole } = require('../services/userService');
    await expect(updateUserRole('u1', 'admin')).rejects.toThrow(/Only admins/);
  });

  it('upsertStaffProfile throws when no row was updated', async () => {
    mockResults.profiles = { data: [], error: null };
    const { upsertStaffProfile } = require('../services/userService');
    await expect(upsertStaffProfile('u1', { fullName: 'A', phone: '', address: '' })).rejects.toThrow();
  });
});

describe('offline queue (driver start/end trip while offline)', () => {
  it('replays ops queued before the handlers were registered, without waiting for a network change', async () => {
    const queue = require('../utils/offlineQueue');
    await queue.enqueueOfflineOp('startTrip', { tripId: 't1', at: '2026-10-13T09:00:00.000Z' });

    queue.initOfflineQueueSync(); // App.tsx order: init may run before handlers exist
    await tick();
    require('../utils/offlineHandlers').registerDefaultOfflineHandlers();
    for (let i = 0; i < 5; i++) await tick();

    expect(mockCalls.some(c => c.table === 'trips' && opArgs(c, 'update'))).toBe(true);
    expect(await queue.getPendingOfflineCount()).toBe(0);
  });

  it('records the time the driver tapped Start/End, not the sync time', async () => {
    const queue = require('../utils/offlineQueue');
    require('../utils/offlineHandlers').registerDefaultOfflineHandlers();
    await tick();
    await queue.enqueueOfflineOp('startTrip', { tripId: 't1', at: '2026-10-13T09:00:00.000Z' });
    await queue.enqueueOfflineOp('endTrip', { tripId: 't1', at: '2026-10-13T11:30:00.000Z' });
    await queue.flushOfflineQueue();

    const updates = mockCalls.filter(c => c.table === 'trips').map(c => opArgs(c, 'update')![0]);
    expect(updates[0].departure_time).toBe('2026-10-13T09:00:00.000Z');
    expect(updates[1].arrival_time).toBe('2026-10-13T11:30:00.000Z');
  });

  it('keeps ops queued while offline', async () => {
    mockOnline = false;
    const queue = require('../utils/offlineQueue');
    queue.registerOfflineHandler('startTrip', () => Promise.reject(new Error('Network request failed')));
    await queue.enqueueOfflineOp('startTrip', { tripId: 't1' });
    for (let i = 0; i < 3; i++) await queue.flushOfflineQueue();
    expect(await queue.getPendingOfflineCount()).toBe(1);
  });

  it('drops an op that keeps failing while online so it cannot block the queue forever', async () => {
    const queue = require('../utils/offlineQueue');
    const ok = jest.fn(() => Promise.resolve());
    queue.registerOfflineHandler('bad', () => Promise.reject(new Error('trip not found')));
    queue.registerOfflineHandler('good', ok);
    await queue.enqueueOfflineOp('bad', {});
    await queue.enqueueOfflineOp('good', {});
    for (let i = 0; i < 6; i++) await queue.flushOfflineQueue();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(await queue.getPendingOfflineCount()).toBe(0);
  });
});

describe('driver record linking', () => {
  it('claimDriverRecord calls the claim_driver_record RPC', async () => {
    mockRpc.claim_driver_record = { data: 'driver-1', error: null };
    const { claimDriverRecord } = require('../services/driverService');
    expect(await claimDriverRecord()).toBe('driver-1');
  });
});
