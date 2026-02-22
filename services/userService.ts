import {
  collection,
  doc,
  getDocs,
  setDoc,
  getDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import * as FileSystem from 'expo-file-system';

export interface UserProfile {
  uid: string;
  email: string;
  role: 'driver' | 'manager' | 'admin';
  createdAt?: any;
}

const usersRef = collection(db, 'users');

export const createUserProfile = async (
  uid: string,
  email: string,
  role: 'driver' | 'manager' | 'admin' = 'driver'
) => {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(userDocRef, {
      uid,
      email,
      role,
      createdAt: new Date(),
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
    await updateDoc(userDocRef, { role });
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

    // Read file and convert to base64
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });

    // Determine image type
    const imageType = imageUri.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    
    return `data:image/${imageType};base64,${base64}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    // Return original URI if conversion fails
    return imageUri;
  }
};
