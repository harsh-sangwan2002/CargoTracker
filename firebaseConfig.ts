// firebaseConfig.ts (or firebase.ts)

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDtjMdqoVfe33zf6IyzvJzqVtPC_2E1pso",
  authDomain: "cargotracker-7fd00.firebaseapp.com",
  projectId: "cargotracker-7fd00",
  storageBucket: "cargotracker-7fd00.appspot.com",
  messagingSenderId: "101210758826",
  appId: "1:101210758826:web:3739e56cded77c7ac7fad3",
  measurementId: "G-HHKTJSFRBL",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Auth
export const auth = getAuth(app);

// Export Firestore
export const db = getFirestore(app);

// Optional: export app if needed
export default app;