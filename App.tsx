import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from './firebaseConfig';
import { Colors } from './utils/theme';

import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import MainTabsScreen from './screens/MainTabsScreen';
import DriverManagementScreen from './screens/DriverManagementScreen';
import UserManagementScreen from './screens/UserManagementScreen';
import PlantManagementScreen from './screens/PlantManagementScreen';
import LiveMapScreen from './screens/LiveMapScreen';

const Stack = createNativeStackNavigator();

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  MainTabs: undefined;
  DriverManagement: undefined;
  UserManagement: undefined;
  PlantManagement: undefined;
  LiveMap: undefined;
};

export default function App() {
  const [user, setUser] = useState<any>(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return unsubscribe;
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        {user ? (
          <>
            <Stack.Screen name="MainTabs" component={MainTabsScreen} />
            <Stack.Screen
              name="DriverManagement"
              component={DriverManagementScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="UserManagement"
              component={UserManagementScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="PlantManagement"
              component={PlantManagementScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="LiveMap"
              component={LiveMapScreen}
              options={{ animation: 'slide_from_right' }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
