// Session/cache isolation regression test (asserts expected behaviour; a failure = bug).
jest.mock('react-native-url-polyfill/auto', () => ({}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signOut: jest.fn(() => Promise.resolve({ error: null })),
      getSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from '../supabaseConfig';
import { setCache, getCache, TTL } from '../utils/cache';

describe('signOut', () => {
  it('clears cached org data so the next user on the device cannot read it', async () => {
    // An admin's session cached every trip and every driver (incl. Aadhaar/PAN).
    await setCache('trips_all', [{ id: 't1' }], TTL.SHORT);
    await setCache('drivers_all', [{ id: 'd1', aadhaarCard: '123412341234' }], TTL.MEDIUM);

    await signOut();

    // A driver logging in on the same device within the TTL is served this cache
    // by getTrips()/getDrivers() without any RLS check.
    expect(await getCache('trips_all')).toBeNull();
    expect(await getCache('drivers_all')).toBeNull();
  });

  it('clears the offline write queue of the previous user', async () => {
    await AsyncStorage.setItem('ct_offline_queue', JSON.stringify([{ id: '1', type: 'endTrip', payload: { tripId: 't' } }]));
    await signOut();
    expect(await AsyncStorage.getItem('ct_offline_queue')).toBeNull();
  });
});
