import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, fonts, radius, shadow } from '../theme';

// Dual animated expanding radar wave rings
function RadarPulse({ children }) {
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulse = (anim, delay) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ])
      );
    };

    const loop1 = createPulse(wave1, 0);
    const loop2 = createPulse(wave2, 1100);

    loop1.start();
    loop2.start();

    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [wave1, wave2]);

  const scale1 = wave1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const opacity1 = wave1.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.55, 0.25, 0] });

  const scale2 = wave2.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const opacity2 = wave2.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.55, 0.25, 0] });

  return (
    <View style={styles.pulseContainer} pointerEvents="none">
      <Animated.View
        style={[
          styles.radarRing,
          {
            transform: [{ scale: scale1 }],
            opacity: opacity1,
          },
        ]}
      />
      <Animated.View
        style={[
          styles.radarRing,
          {
            transform: [{ scale: scale2 }],
            opacity: opacity2,
          },
        ]}
      />
      {children}
    </View>
  );
}

export default function AIAssistantFAB({ onPress, bottom = 80 }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.94,
      speed: 40,
      bounciness: 4,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      speed: 40,
      bounciness: 6,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  return (
    <View style={[styles.fabContainer, { bottom }]} pointerEvents="box-none">
      <RadarPulse>
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            style={({ pressed }) => [styles.fabBtn, pressed && styles.fabPressed]}
            onPress={onPress}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open RiskN AI Assistant"
          >
            {/* Luminous Inner Glow Dot */}
            <View style={styles.iconWrap}>
              <View style={styles.shieldGlow}>
                <Feather name="shield" size={17} color="#FFFFFF" />
              </View>
              <View style={styles.aiSparkle}>
                <Feather name="zap" size={9} color="#22D3EE" />
              </View>
            </View>

            <View style={styles.badgeWrap}>
              <View style={styles.livePulseLed} />
              <Text style={styles.badgeText}>RiskN AI</Text>
            </View>
          </Pressable>
        </Animated.View>
      </RadarPulse>
    </View>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    right: 18,
    zIndex: 9999,
  },
  pulseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  radarRing: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    left: -6,
    right: -6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: '#22D3EE',
  },
  fabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B172C',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(34, 211, 238, 0.85)',
    ...shadow,
    shadowColor: '#22D3EE',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  fabPressed: {
    opacity: 0.92,
  },
  iconWrap: {
    position: 'relative',
    marginRight: 7,
  },
  shieldGlow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSparkle: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#07101E',
    borderRadius: 6,
    padding: 1.5,
    borderWidth: 0.8,
    borderColor: 'rgba(34, 211, 238, 0.4)',
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1565FF',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    gap: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  livePulseLed: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#38BDF8',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.5,
  },
});
