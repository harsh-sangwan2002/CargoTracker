// Service-layer regression tests. Each test asserts the expected (correct) behaviour,
// so a failing test points at a bug. The Supabase client is replaced with a recorder
// that captures every query builder call.

type Op = [string, any[]];
interface MockCall { table: string; ops: Op[] }

const mockCalls: MockCall[] = [];
let mockResults: Record<string, any> = {};

jest.mock('../supabaseConfig', () => {
  const makeBuilder = (table: string) => {
    const call: MockCall = { table, ops: [] };
    mockCalls.push(call);
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const result = mockResults[table] ?? { data: [], error: null };
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
      functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) },
    },
    auth: { currentUser: null },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('expo-file-system', () => ({ File: class {} }), { virtual: true });

import AsyncStorage from '@react-native-async-storage/async-storage';

const opArgs = (call: MockCall, name: string) => call.ops.find(([n]) => n === name)?.[1];

beforeEach(async () => {
  mockCalls.length = 0;
  mockResults = {};
  await AsyncStorage.clear();
  jest.resetModules();
});

describe('analytics: distance & fuel per truck', () => {
  it('uses the odometer-computed distance_travelled_km, not the legacy text column', async () => {
    // What the DB holds after TripsScreen saves a trip with odometer 100→350 and a blank
    // distance field: the trigger fills distance_travelled_km, the text column stays '0'.
    mockResults.trips = {
      data: [{
        id: 't1', truck: 'HR55AB1234', vehicle_id: 'v1', departure_time: new Date().toISOString(),
        distance_travelled: '0', distance_travelled_km: 250, fuel_filled: '40', fuel_filled_liters: 40,
        odometer_start: 100, odometer_end: 350,
      }],
      error: null,
    };
    const { getTrips } = require('../services/tripService');
    const { vehicleStatsFromTrips } = require('../services/analyticsService');
    const trips = await getTrips();
    const [stat] = vehicleStatsFromTrips(trips, [{ id: 'v1', registrationNumber: 'HR55AB1234' }]);
    expect(stat.distanceKm).toBe(250);
    expect(stat.kmPerLiter).toBeCloseTo(6.25);
  });
});

describe('userService.deleteUserAccountData', () => {
  it('does not delete trips merely created by the user being deleted (e.g. a manager)', async () => {
    const { deleteUserAccountData } = require('../services/userService');
    await deleteUserAccountData('manager-uid');
    const tripDelete = mockCalls.find(c => c.table === 'trips' && c.ops.some(([n]) => n === 'delete'));
    expect(tripDelete).toBeDefined();
    const orFilter: string = opArgs(tripDelete!, 'or')?.[0] ?? '';
    // user_id is the *creator* of the trip; deleting a manager wipes every trip they dispatched.
    expect(orFilter).not.toContain('user_id.eq.manager-uid,');
    expect(orFilter.startsWith('user_id.eq.')).toBe(false);
  });
});

describe('offline queue (driver start/end trip while offline)', () => {
  it('replays ops queued before the screen registered its handler, without waiting for a network change', async () => {
    const queue = require('../utils/offlineQueue');
    const handler = jest.fn(() => Promise.resolve());
    await queue.enqueueOfflineOp('startTrip', { tripId: 't1' });

    // App.tsx: initOfflineQueueSync() runs at launch, before DriverHomeScreen mounts.
    queue.initOfflineQueueSync();
    await new Promise(r => setTimeout(r, 0));
    // DriverHomeScreen mounts later and registers the handler.
    queue.registerOfflineHandler('startTrip', handler);
    await new Promise(r => setTimeout(r, 0));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await queue.getPendingOfflineCount()).toBe(0);
  });

  it('records the time the driver actually started the trip, not the time the queue synced', async () => {
    const realNow = Date.now;
    const tappedStartAt = new Date('2026-10-13T09:00:00.000Z').getTime();
    const syncedAt = new Date('2026-10-13T14:00:00.000Z').getTime();
    try {
      const queue = require('../utils/offlineQueue');
      const { startTrip } = require('../services/tripService');

      jest.useFakeTimers({ now: tappedStartAt, doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] });
      await queue.enqueueOfflineOp('startTrip', { tripId: 't1' }); // DriverHomeScreen.handleStartTrip (offline)

      jest.setSystemTime(syncedAt);
      // Same handler DriverHomeScreen registers.
      queue.registerOfflineHandler('startTrip', async (p: any) => { await startTrip(p.tripId); });
      await queue.flushOfflineQueue();

      const update = mockCalls.find(c => c.table === 'trips' && c.ops.some(([n]) => n === 'update'));
      const payload = opArgs(update!, 'update')?.[0];
      expect(payload.departure_time).toBe(new Date(tappedStartAt).toISOString());
    } finally {
      jest.useRealTimers();
      Date.now = realNow;
    }
  });
});
