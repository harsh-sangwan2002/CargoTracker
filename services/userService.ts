import {
  collection,
  doc,
  getDocs,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import {db} from '../firebaseConfig';
import {File} from 'expo-file-system';
import {getDrivers} from './driverService';

export interface UserProfile {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  createdAt?: any;
}

const usersRef = collection(db, 'users');

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const createUserProfile = async (
  uid: string,
  email: string,
  role: 'driver' | 'manager' | 'admin' = 'driver'
) => {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      uid,
      email: normalizeEmail(email),
      role,
      createdAt: new Date()
    });
  } catch (error) {
    console.error('Error creating user profile:', error);
    throw error;
  }
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      return userDoc.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error('Error getting user profile:', error);
    throw error;
  }
};

export const updateUserRole = async (uid: string, role: 'driver' | 'manager' | 'admin') => {
  try {
    const userDocRef = doc(db, 'users', uid);
    await updateDoc(userDocRef, {role});
  } catch (error) {
    console.error('Error updating user role:', error);
    throw error;
  }
};

export const isManager = async (uid: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(uid);
    console.log('📋 Manager check for', uid, ':', profile);
    return profile?.role === 'manager' || profile?.role === 'admin';
  } catch (error) {
    console.error('Error checking manager status:', error);
    return false;
  }
};

export const isAdmin = async (uid: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(uid);
    return profile?.role === 'admin';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

// Convert image file to base64 data URL
export const convertImageToBase64 = async (imageUri: string): Promise<string> => {
  try {
    // If it's already a data URI, return as is
    if (imageUri.startsWith('data:')) {
      return imageUri;
    }

    // Read file and convert to base64 using the Expo SDK 54 File API.
    const imageFile = new File(imageUri);
    const base64 = await imageFile.base64();

    // Determine image type
    const imageType = imageUri.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';

    return `data:image/${imageType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    // Return original URI if conversion fails
    return imageUri;
  }
};

const deleteDocsInBatches = async (docsToDelete: Array<{ref: any}>) => {
  const BATCH_LIMIT = 450;
  for (let i = 0; i < docsToDelete.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const slice = docsToDelete.slice(i, i + BATCH_LIMIT);
    slice.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
};

export const deleteUserAccountData = async (uid: string) => {
  const tripsRef = collection(db, 'trips');

  const [tripsSnap, driversList] = await Promise.all([
    getDocs(query(tripsRef, where('userId', '==', uid))),
    getDrivers(uid)
  ]);

  const driverRefs = driversList.map(d => ({ref: doc(db, 'drivers', d.id)}));

  await deleteDocsInBatches(tripsSnap.docs);
  await deleteDocsInBatches(driverRefs);

  await deleteDoc(doc(usersRef, uid));
};
