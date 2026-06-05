import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../utils/theme';
import type { UserRole } from './MainTabsScreen';

interface Props {
  role: UserRole;
}

interface ManageItem {
  title: string;
  subtitle: string;
  icon: string;
  screen: string;
  color: string;
  roles: UserRole[];
}

const ITEMS: ManageItem[] = [
  {
    title: 'Live Driver Map',
    subtitle: 'View real-time GPS locations of active drivers',
    icon: '🗺️',
    screen: 'LiveMap',
    color: Colors.info,
    roles: ['manager', 'admin'],
  },
  {
    title: 'Drivers',
    subtitle: 'Add, view, edit and remove drivers',
    icon: '🚗',
    screen: 'DriverManagement',
    color: Colors.success,
    roles: ['manager', 'admin'],
  },
  {
    title: 'Users & Roles',
    subtitle: 'Manage user accounts and permissions',
    icon: '👥',
    screen: 'UserManagement',
    color: Colors.primary,
    roles: ['admin'],
  },
  {
    title: 'Plants',
    subtitle: 'Add and manage plant locations',
    icon: '🏭',
    screen: 'PlantManagement',
    color: Colors.warning,
    roles: ['manager', 'admin'],
  },
];

export default function ManageHubScreen({ role }: Props) {
  const navigation = useNavigation<any>();
  const visible = ITEMS.filter(i => i.roles.includes(role));

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>Manage</Text>
        <Text style={s.pageSub}>Administration & configuration</Text>

        <View style={s.grid}>
          {visible.map(item => (
            <TouchableOpacity
              key={item.screen}
              style={s.card}
              onPress={() => navigation.navigate(item.screen)}
              activeOpacity={0.8}
            >
              <View style={[s.iconBox, { backgroundColor: item.color + '18' }]}>
                <Text style={s.icon}>{item.icon}</Text>
              </View>
              <Text style={s.cardTitle}>{item.title}</Text>
              <Text style={s.cardSub}>{item.subtitle}</Text>
              <View style={[s.arrow, { backgroundColor: item.color + '18' }]}>
                <Text style={[s.arrowText, { color: item.color }]}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {visible.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>🔒</Text>
            <Text style={s.emptyText}>No management access</Text>
            <Text style={s.emptySub}>Contact an admin to update your role.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = {
  safe: { flex: 1, backgroundColor: Colors.background } as const,
  scroll: { padding: Spacing[5], paddingBottom: Spacing[10] } as const,

  pageTitle: {
    fontSize: FontSize['3xl'],
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    marginBottom: Spacing[1],
  },
  pageSub: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginBottom: Spacing[6],
  },

  grid: { gap: Spacing[4] } as const,

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing[5],
    ...Shadow.md,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: Spacing[3],
  },
  icon: { fontSize: 26 },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: Spacing[1],
  },
  cardSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing[4],
    lineHeight: 20,
  },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-end' as const,
  },
  arrowText: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },

  empty: {
    alignItems: 'center' as const,
    paddingVertical: Spacing[12],
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing[3] },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700' as const, color: Colors.textSecondary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing[1], textAlign: 'center' as const },
};
