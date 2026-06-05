import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout } from 'react-native-maps';
import { useNavigation } from '@react-navigation/native';
import { subscribeToActiveLocations, DriverLocation } from '../services/locationService';
import { Colors, FontSize, Radius, Spacing } from '../utils/theme';

export default function LiveMapScreen() {
  const navigation = useNavigation();
  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToActiveLocations((locs) => {
      setLocations(locs);
      setLoading(false);
    });
    return unsub;
  }, []);

  const initialRegion = locations.length > 0
    ? { latitude: locations[0].lat, longitude: locations[0].lng, latitudeDelta: 0.5, longitudeDelta: 0.5 }
    : { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 12, longitudeDelta: 12 };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', padding: Spacing[4],
        backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: Spacing[3], padding: 4 }}>
          <Text style={{ fontSize: 22, color: Colors.text }}>←</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, flex: 1 }}>
          Live Driver Map
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: locations.length > 0 ? Colors.success : Colors.textMuted }} />
          <Text style={{ fontSize: FontSize.sm, color: Colors.textSecondary }}>
            {locations.length} active
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={{ marginTop: 12, color: Colors.textSecondary }}>Loading live locations…</Text>
        </View>
      ) : (
        <MapView style={{ flex: 1 }} initialRegion={initialRegion} showsUserLocation showsCompass>
          {locations.map(loc => (
            <Marker
              key={loc.userId}
              coordinate={{ latitude: loc.lat, longitude: loc.lng }}
              pinColor={Colors.primary}
            >
              <Callout tooltip={false}>
                <View style={{ padding: 8, minWidth: 160 }}>
                  <Text style={{ fontWeight: '700', fontSize: FontSize.sm, color: Colors.text }}>
                    🚛  {loc.driverName}
                  </Text>
                  {loc.tripRoute ? (
                    <Text style={{ color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: 3 }}>
                      {loc.tripRoute}
                    </Text>
                  ) : null}
                  <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 3 }}>
                    {new Date(loc.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      )}

      {!loading && locations.length === 0 && (
        <View style={{
          position: 'absolute', bottom: 48, alignSelf: 'center',
          backgroundColor: Colors.surface, borderRadius: Radius.lg,
          padding: Spacing[4], flexDirection: 'row', alignItems: 'center', gap: 8,
          shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
        }}>
          <Text style={{ fontSize: 22 }}>🚛</Text>
          <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm }}>
            No drivers are currently tracking
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
