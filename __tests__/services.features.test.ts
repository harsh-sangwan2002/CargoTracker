// Unit tests for the HLD/LLD feature and security work on the client service layer.
// The Supabase client is replaced with a recorder (same approach as services.bugs.test.ts).

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
  const storageBucket = (bucket: string) => ({
    upload: jest.fn((path: string) => {
      mockCalls.push({ table: `storage:${bucket}`, ops: [['upload', [path]]] });
      return Promise.resolve({ data: { path }, error: null });
    }),
    remove: jest.fn(() => Promise.resolve({ data: [], error: null })),
    createSignedUrls: jest.fn((paths: string[]) =>
      Promise.resolve({ data: paths.map(p => ({ path: p, signedUrl: `https://signed/${p}` })), error: null })
    ),
  });
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      rpc: (fn: string, args?: any) => {
        mockCalls.push({ table: `rpc:${fn}`, ops: [['rpc', [args]]] });
        return Promise.resolve(mockResults[`rpc:${fn}`] ?? { data: null, error: null });
      },
      storage: { from: storageBucket },
      functions: { invoke: jest.fn(() => Promise.resolve({ data: null, error: null })) },
    },
    invokeFunction: jest.fn(() => Promise.resolve({})),
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

jest.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}
    base64() { return Promise.resolve('aGVsbG8='); } // "hello"
  },
}), { virtual: true });

import AsyncStorage from '@react-native-async-storage/async-storage';

const opArgs = (call: MockCall, name: string) => call.ops.find(([n]) => n === name)?.[1];
const callsTo = (table: string) => mockCalls.filter(c => c.table === table);

beforeEach(async () => {
  mockCalls.length = 0;
  mockResults = {};
  await AsyncStorage.clear();
  jest.resetModules();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

const trip = (fields: Record<string, any>) => ({
  id: Math.random().toString(36).slice(2),
  truck: '', bidNo: '', driverName: '', companyName: '', itemType: '', quantity: '',
  fuelFilled: '0', distanceTravelled: '0', departureTime: new Date('2026-10-01T05:00:00Z'), arrivalTime: null,
  fromPlant: '', toPlant: '', status: 'active', time: '', createdAt: null,
  ...fields,
});

describe('analyticsService', () => {
  it('escapes CSV cells and neutralises spreadsheet formulas', () => {
    const { toCsv } = require('../services/analyticsService');
    const csv = toCsv(['Name', 'Note'], [['=HYPERLINK("http://x")', 'a,b'], ['+91 999', 'say "hi"'], ['@SUM(A1)', '-5']]);
    expect(csv.split('\n')).toEqual([
      'Name,Note',
      `"'=HYPERLINK(""http://x"")","a,b"`,
      `'+91 999,"say ""hi"""`,
      `'@SUM(A1),'-5`,
    ]);
  });

  it('builds per-driver performance, excluding cancelled trips', () => {
    const { driverPerformanceFromTrips } = require('../services/analyticsService');
    const trips = [
      trip({ driverId: 'd1', distanceTravelled: '200', fuelFilled: '40', arrivalTime: new Date('2026-10-01T09:00:00Z') }),
      trip({ driverId: 'd1', distanceTravelled: '100', fuelFilled: '20' }),
      trip({ driverId: 'd1', distanceTravelled: '999', fuelFilled: '99', tripStatus: 'cancelled' }),
    ];
    const [perf] = driverPerformanceFromTrips(trips, new Map([['d1', 'Ravi']]));
    expect(perf).toMatchObject({ name: 'Ravi', trips: 2, completed: 1, completionRate: 0.5, distanceKm: 300, fuelLiters: 60 });
    expect(perf.kmPerLiter).toBeCloseTo(5);
    expect(perf.avgTripHours).toBeCloseTo(4);
  });

  it('uses server aggregates when available and falls back to local trips otherwise', async () => {
    const { getVehicleStatsForRange } = require('../services/analyticsService');
    const vehicles = [{ id: 'v1', registrationNumber: 'HR55AB1234' }];
    const range = { start: new Date('2026-01-01'), end: new Date('2026-10-01') };

    mockResults['rpc:get_trip_analytics'] = {
      data: [
        { vehicle_id: 'v1', driver_id: 'd1', trip_count: 3, completed_count: 2, distance_km: '600', fuel_liters: '100' },
        { vehicle_id: 'v1', driver_id: 'd2', trip_count: 1, completed_count: 1, distance_km: '150', fuel_liters: '25' },
      ],
      error: null,
    };
    const server = await getVehicleStatsForRange(range, [], vehicles);
    expect(server.source).toBe('server');
    expect(server.stats).toEqual([
      { vehicleId: 'v1', registrationNumber: 'HR55AB1234', trips: 4, distanceKm: 750, fuelLiters: 125, kmPerLiter: 6 },
    ]);
    const [{ ops }] = callsTo('rpc:get_trip_analytics');
    expect(ops[0][1][0]).toMatchObject({ p_start: '2026-01-01T00:00:00.000Z', p_driver_id: null });

    mockResults['rpc:get_trip_analytics'] = { data: null, error: { message: 'function does not exist', code: '42883' } };
    const local = await getVehicleStatsForRange(range, [trip({ vehicleId: 'v1', distanceTravelled: '50', fuelFilled: '10' })], vehicles);
    expect(local.source).toBe('client');
    expect(local.stats[0]).toMatchObject({ trips: 1, distanceKm: 50, kmPerLiter: 5 });
  });
});

describe('base64ToBytes', () => {
  it('decodes with and without padding', () => {
    const { base64ToBytes } = require('../utils/base64');
    const text = (s: string) => String.fromCharCode(...base64ToBytes(s));
    expect(text('aGVsbG8=')).toBe('hello');
    expect(text('aGk=')).toBe('hi');
    expect(text('aGV5')).toBe('hey');
    expect(Array.from(base64ToBytes('/+8='))).toEqual([255, 239]);
  });
});

describe('driverService (PII handling)', () => {
  it('never selects Aadhaar/PAN columns from the drivers table', async () => {
    const { getDrivers, getDriverByEmail } = require('../services/driverService');
    await getDrivers();
    await getDriverByEmail('a@b.com');
    for (const call of callsTo('drivers')) {
      const columns: string = opArgs(call, 'select')?.[0];
      expect(columns).toBeDefined();
      expect(columns).not.toBe('*');
      expect(columns).not.toMatch(/aadhaar|pan_number/);
    }
  });

  it("doesn't blank stored Aadhaar/PAN when a manager saves without them", async () => {
    mockResults['drivers'] = { data: [{ id: 'd1' }], error: null };
    const { updateDriver } = require('../services/driverService');
    await updateDriver('d1', { fullName: 'Ravi', aadhaarCard: '', panCard: '' });
    const payload = opArgs(callsTo('drivers')[0], 'update')?.[0];
    expect(payload).toEqual({ full_name: 'Ravi' });
  });

  it('reads PII only through the admin-gated RPC', async () => {
    mockResults['rpc:get_driver_pii'] = { data: [{ aadhaar_number: '123412341234', pan_number: 'ABCDE1234F' }], error: null };
    const { getDriverPii, maskId } = require('../services/driverService');
    expect(await getDriverPii('d1')).toEqual({ aadhaarCard: '123412341234', panCard: 'ABCDE1234F' });
    expect(maskId('123412341234')).toBe('••••••••1234');
    expect(maskId('')).toBe('');
  });

  it('uploads photos to the private bucket and resolves signed URLs', async () => {
    mockResults['drivers'] = { data: [{ id: 'd1' }], error: null };
    const { setDriverPhoto, resolveDriverPhotoUrls } = require('../services/driverService');
    const path = await setDriverPhoto('d1', 'file:///tmp/photo.jpg');
    expect(path).toMatch(/^d1\/\d+\.jpg$/);
    expect(callsTo('storage:driver-photos')).toHaveLength(1);
    expect(opArgs(callsTo('drivers')[0], 'update')?.[0]).toEqual({ photo_path: path });

    const urls = await resolveDriverPhotoUrls([path, 'data:image/jpeg;base64,xx', '']);
    expect(urls[path]).toBe(`https://signed/${path}`);
    expect(urls['data:image/jpeg;base64,xx']).toBe('data:image/jpeg;base64,xx');
  });
});

describe('tripService start/end', () => {
  it('captures odometer readings and ignores invalid ones', async () => {
    const { startTrip, endTrip } = require('../services/tripService');
    await startTrip('t1', { odometerStart: 1200 });
    await endTrip('t1', { odometerEnd: Number.NaN });
    const [start, end] = callsTo('trips').map(c => opArgs(c, 'update')?.[0]);
    expect(start).toMatchObject({ trip_status: 'active', odometer_start: 1200 });
    expect(end).toMatchObject({ trip_status: 'completed' });
    expect(end).not.toHaveProperty('odometer_end');
  });

  it('filters date-range queries by the assigned driver, not the trip creator', async () => {
    const { getTripsByDateRange } = require('../services/tripService');
    await getTripsByDateRange(new Date('2026-10-01'), new Date('2026-10-02'), 'driver-uid');
    const call = callsTo('trips')[0];
    expect(opArgs(call, 'eq')).toEqual(['driver_user_id', 'driver-uid']);
    expect(opArgs(call, 'gte')?.[0]).toBe('departure_time');
  });
});

describe('offline queue', () => {
  it('drops an op the server permanently rejects so later ops still sync', async () => {
    const queue = require('../utils/offlineQueue');
    const replayed: string[] = [];
    await queue.enqueueOfflineOp('endTrip', { tripId: 'closed-by-manager' });
    await queue.enqueueOfflineOp('endTrip', { tripId: 't2' });
    queue.registerOfflineHandler('endTrip', async (p: any) => {
      if (p.tripId === 'closed-by-manager') throw Object.assign(new Error('trip is already closed'), { code: '42501' });
      replayed.push(p.tripId);
    });
    await queue.flushOfflineQueue();
    expect(replayed).toEqual(['t2']);
    expect(await queue.getPendingOfflineCount()).toBe(0);
  });

  it('keeps ops queued while the network is still down', async () => {
    const queue = require('../utils/offlineQueue');
    await queue.enqueueOfflineOp('startTrip', { tripId: 't1' });
    queue.registerOfflineHandler('startTrip', async () => { throw new TypeError('Network request failed'); });
    await queue.flushOfflineQueue();
    expect(await queue.getPendingOfflineCount()).toBe(1);
  });
});

describe('documentService', () => {
  it('stores scans under <entity>/<id>/<type>/ so Storage policies can scope them', async () => {
    mockResults.documents = { data: { id: 'doc1' }, error: null };
    const { addDocument } = require('../services/documentService');
    await addDocument({ entityType: 'driver', entityId: 'd1', docType: 'license', expiryDate: '2027-01-31', localUri: 'file:///x.jpg' });
    const [upload] = callsTo('storage:documents');
    expect(opArgs(upload, 'upload')?.[0]).toMatch(/^driver\/d1\/license\/\d+\.jpg$/);
    expect(opArgs(callsTo('documents')[0], 'insert')?.[0]).toMatchObject({
      entity_type: 'driver', entity_id: 'd1', doc_type: 'license', expiry_date: '2027-01-31',
    });
  });
});
