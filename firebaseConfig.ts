import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDtjMdqoVfe33zf6IyzvJzqVtPC_2E1pso',
  authDomain: 'cargotracker-7fd00.firebaseapp.com',
  projectId: 'cargotracker-7fd00',
  storageBucket: 'cargotracker-7fd00.appspot.com',
  messagingSenderId: '101210758826',
  appId: '1:101210758826:web:3739e56cded77c7ac7fad3',
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
export const db = getFirestore(app);
export default app;
