import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoute, useNavigation } from '@react-navigation/native';
import { auth } from '../supabaseConfig';
import { getUserProfile } from '../services/userService';
import { getDriverByUserId, getDriverByEmail, linkDriverToUser } from '../services/driverService';
import { registerForPushNotifications } from '../utils/pushNotifications';
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
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const routeParams = route.params as { driverFilter?: string; openTrips?: boolean } | undefined;

  const [activeTab, setActiveTab] = useState<TabId>(routeParams?.openTrips ? 'trips' : 'home');
  const [driverFilter, setDriverFilter] = useState<string | undefined>(routeParams?.driverFilter);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>('driver');
  const [loadingRole, setLoadingRole] = useState(true);
  const [profileComplete, setProfileComplete] = useState(true);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user?.uid) { setLoadingRole(false); return; }
    const cacheKey = `ct_role_${user.uid}`;
    AsyncStorage.getItem(cacheKey).then(cached => {
      if (cached) { setRole(cached as UserRole); setLoadingRole(false); }
    }).catch(() => {});
    getUserProfile(user.uid).then(profile => {
      if (profile?.role) {
        setRole(profile.role as UserRole);
        AsyncStorage.setItem(cacheKey, profile.role).catch(() => {});
      }
      setLoadingRole(false);
    }).catch(() => setLoadingRole(false));
  }, []);

  // Consume driverFilter / openTrips params from navigation (e.g. from DriverManagement → View Trips)
  useEffect(() => {
    if (routeParams?.openTrips) {
      setActiveTab('trips');
      setDriverFilter(routeParams.driverFilter);
      navigation.setParams({ openTrips: undefined, driverFilter: undefined });
    }
  }, [routeParams?.openTrips, routeParams?.driverFilter]);

  // Register this device for push notifications once we know who's signed in.
  useEffect(() => {
    if (!user?.uid) return;
    registerForPushNotifications(user.uid).catch(() => {});
  }, [user?.uid]);

  // Check driver profile completeness + auto-link admin-created record
  useEffect(() => {
    if (role !== 'driver' || !user?.uid) return;
    const uid = user.uid;
    const email = (user.email ?? '').trim().toLowerCase();
    (async () => {
      try {
        const byUid = await getDriverByUserId(uid);
        if (byUid) {
          setProfileComplete(!!byUid.fullName?.trim());
          return;
        }
        if (email) {
          const byEmail = await getDriverByEmail(email);
          if (byEmail) {
            await linkDriverToUser(byEmail.id, uid);
            setProfileComplete(!!byEmail.fullName?.trim());
            return;
          }
        }
        setProfileComplete(false);
      } catch {
        setProfileComplete(false);
      }
    })();
  }, [role]);

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
          ? <DriverHomeScreen
              onTabPress={setActiveTab}
              onNavigateToTrip={(tripId) => { setPendingTripId(tripId); setActiveTab('trips'); }}
            />
          : <DashboardScreen role={role} onTabPress={setActiveTab} />;
      case 'trips': return (
        <TripsScreen
          role={role}
          pendingTripId={pendingTripId}
          onPendingTripConsumed={() => setPendingTripId(null)}
          initialSearch={driverFilter}
        />
      );
      case 'analytics': return <AnalyticsScreen role={role} />;
      case 'manage': return <ManageHubScreen role={role} />;
      case 'profile': return (
        <ProfileScreen
          role={role}
          profileComplete={profileComplete}
          onProfileSaved={() => setProfileComplete(true)}
        />
      );
      default:
        return role === 'driver'
          ? <DriverHomeScreen
              onTabPress={setActiveTab}
              onNavigateToTrip={(tripId) => { setPendingTripId(tripId); setActiveTab('trips'); }}
            />
          : <DashboardScreen role={role} onTabPress={setActiveTab} />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{ flex: 1 }}>{renderContent()}</View>
      <View style={[tabBar.container, { paddingBottom: 4 + insets.bottom }]}>
        {visibleTabs.map(tab => {
          const active = activeTab === tab.id;
          const showBadge = role === 'driver' && !profileComplete && tab.id === 'profile';
          return (
            <TouchableOpacity
              key={tab.id}
              style={tabBar.tab}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <View style={{ position: 'relative' }}>
                <Text style={[tabBar.icon, active && tabBar.iconActive]}>{tab.icon}</Text>
                {showBadge && <View style={tabBar.incompleteBadge} />}
              </View>
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
  incompleteBadge: {
    position: 'absolute' as const,
    top: -2,
    right: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.danger,
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
};
