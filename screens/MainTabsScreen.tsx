import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../firebaseConfig';
import { getUserProfile } from '../services/userService';
import { Colors, FontSize, Shadow } from '../utils/theme';
import DashboardScreen from './DashboardScreen';
import DriverHomeScreen from './DriverHomeScreen';
import TripsScreen from './TripsScreen';
import AnalyticsScreen from './AnalyticsScreen';
import ManageHubScreen from './ManageHubScreen';
import ProfileScreen from './ProfileScreen';

export type UserRole = 'driver' | 'manager' | 'admin';
export type TabId = 'home' | 'trips' | 'analytics' | 'manage' | 'profile';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  roles?: UserRole[];
}

const ALL_TABS: Tab[] = [
  { id: 'home', label: 'Home', icon: '⊞' },
  { id: 'trips', label: 'Trips', icon: '🚛' },
  { id: 'analytics', label: 'Reports', icon: '📊', roles: ['manager', 'admin'] },
  { id: 'manage', label: 'Manage', icon: '⚙️', roles: ['manager', 'admin'] },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

export default function MainTabsScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [role, setRole] = useState<UserRole>('driver');
  const [loadingRole, setLoadingRole] = useState(true);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user?.uid) { setLoadingRole(false); return; }
    const cacheKey = `ct_role_${user.uid}`;
    // Load cached role instantly (no spinner on re-open)
    AsyncStorage.getItem(cacheKey).then(cached => {
      if (cached) { setRole(cached as UserRole); setLoadingRole(false); }
    }).catch(() => {});
    // Fetch fresh from Firestore in background
    getUserProfile(user.uid).then(profile => {
      if (profile?.role) {
        setRole(profile.role as UserRole);
        AsyncStorage.setItem(cacheKey, profile.role).catch(() => {});
      }
      setLoadingRole(false);
    }).catch(() => setLoadingRole(false));
  }, []);

  const visibleTabs = ALL_TABS.filter(
    tab => !tab.roles || tab.roles.includes(role)
  );

  if (loadingRole) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return role === 'driver'
          ? <DriverHomeScreen onTabPress={setActiveTab} />
          : <DashboardScreen role={role} onTabPress={setActiveTab} />;
      case 'trips': return <TripsScreen role={role} />;
      case 'analytics': return <AnalyticsScreen role={role} />;
      case 'manage': return <ManageHubScreen role={role} />;
      case 'profile': return <ProfileScreen role={role} />;
      default:
        return role === 'driver'
          ? <DriverHomeScreen onTabPress={setActiveTab} />
          : <DashboardScreen role={role} onTabPress={setActiveTab} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{ flex: 1 }}>{renderContent()}</View>
      <View style={tabBar.container}>
        {visibleTabs.map(tab => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={tabBar.tab}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <Text style={[tabBar.icon, active && tabBar.iconActive]}>{tab.icon}</Text>
              <Text style={[tabBar.label, active && tabBar.labelActive]}>{tab.label}</Text>
              {active && <View style={tabBar.dot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const tabBar = {
  container: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingBottom: 4,
    paddingTop: 8,
    ...Shadow.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 4,
    position: 'relative' as const,
  },
  icon: {
    fontSize: 20,
    marginBottom: 2,
    opacity: 0.4,
  },
  iconActive: {
    opacity: 1,
  },
  label: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '700' as const,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
    position: 'absolute' as const,
    bottom: -2,
  },
};
