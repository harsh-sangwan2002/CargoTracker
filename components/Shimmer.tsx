import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../utils/theme';

// Single shared animation so all shimmers pulse in sync
const pulse = new Animated.Value(0.4);
Animated.loop(
  Animated.sequence([
    Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
    Animated.timing(pulse, { toValue: 0.4, duration: 750, useNativeDriver: true }),
  ])
).start();

const BASE = Colors.border;

interface BoxProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function ShimmerBox({ width = '100%', height = 14, radius = 6, style }: BoxProps) {
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: BASE, opacity: pulse }, style]}
    />
  );
}

export function ShimmerCard({ style }: { style?: ViewStyle }) {
  return (
    <Animated.View
      style={[
        {
          backgroundColor: Colors.surface,
          borderRadius: Radius.lg,
          padding: Spacing[4],
          marginBottom: Spacing[3],
          opacity: pulse,
        },
        style,
      ]}
    >
      <View style={{ height: 15, width: '60%', backgroundColor: BASE, borderRadius: 6, marginBottom: 10 }} />
      <View style={{ height: 12, width: '85%', backgroundColor: BASE, borderRadius: 6, marginBottom: 8 }} />
      <View style={{ height: 12, width: '45%', backgroundColor: BASE, borderRadius: 6 }} />
    </Animated.View>
  );
}

export function ShimmerStatsRow() {
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        backgroundColor: Colors.surface,
        borderRadius: Radius.lg,
        marginBottom: Spacing[5],
        opacity: pulse,
      }}
    >
      {[0, 1, 2].map(i => (
        <View
          key={i}
          style={{
            flex: 1,
            alignItems: 'center',
            paddingVertical: Spacing[4],
            borderRightWidth: i < 2 ? 1 : 0,
            borderRightColor: Colors.border,
          }}
        >
          <View style={{ height: 26, width: 32, backgroundColor: BASE, borderRadius: 6, marginBottom: 6 }} />
          <View style={{ height: 10, width: 52, backgroundColor: BASE, borderRadius: 6 }} />
        </View>
      ))}
    </Animated.View>
  );
}

export function ShimmerList({ count = 4, style }: { count?: number; style?: ViewStyle }) {
  return (
    <View style={style}>
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerCard key={i} />
      ))}
    </View>
  );
}

export function ShimmerRow({ style }: { style?: ViewStyle }) {
  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: Colors.surface,
          borderRadius: Radius.md,
          padding: Spacing[4],
          marginBottom: Spacing[2],
          opacity: pulse,
        },
        style,
      ]}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: BASE, marginRight: Spacing[3] }} />
      <View style={{ flex: 1 }}>
        <View style={{ height: 13, width: '55%', backgroundColor: BASE, borderRadius: 6, marginBottom: 7 }} />
        <View style={{ height: 11, width: '75%', backgroundColor: BASE, borderRadius: 6 }} />
      </View>
    </Animated.View>
  );
}
