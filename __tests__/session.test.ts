// Session/cache isolation and account deletion (real supabaseConfig, mocked SDK).
jest.mock('react-native-url-polyfill/auto', () => ({}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => () => {}),
  fetch: jest.fn(() => Promise.resolve({ isConnected: false, isInternetReachable: false })),
}));

const mockInvoke = jest.fn((_name: string, _opts?: any): Promise<any> => Promise.resolve({ data: { deleted: true }, error: null }));
const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    functions: { invoke: mockInvoke },
    auth: {
      signOut: jest.fn(() => Promise.resolve({ error: null })),
      getSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut, sendOtp } from '../supabaseConfig';
import { setCache, getCache, TTL } from '../utils/cache';

beforeEach(() => {
  mockInvoke.mockClear();
  mockFrom.mockClear();
});

describe('signOut', () => {
  it('clears cached org data so the next user on the device cannot read it', async () => {
    await setCache('trips_all', [{ id: 't1' }], TTL.SHORT);
    await setCache('drivers_all', [{ id: 'd1', aadhaarCard: '123412341234' }], TTL.MEDIUM);
    await AsyncStorage.setItem('ct_role_u1', 'admin');

    await signOut();

    expect(await getCache('trips_all')).toBeNull();
    expect(await getCache('drivers_all')).toBeNull();
    expect(await AsyncStorage.getItem('ct_role_u1')).toBeNull();
  });

  it('clears the offline write queue of the previous user', async () => {
    await AsyncStorage.setItem('ct_offline_queue', JSON.stringify([{ id: '1', type: 'endTrip', payload: { tripId: 't' } }]));
    await signOut();
    expect(await AsyncStorage.getItem('ct_offline_queue')).toBeNull();
  });
});

describe('sendOtp', () => {
  it('surfaces a rate-limit message from the function', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'non-2xx', context: { json: () => Promise.resolve({ error: 'Too many reset requests.' }) } },
    });
    await expect(sendOtp('a@b.c')).rejects.toThrow('Too many reset requests.');
  });
});
