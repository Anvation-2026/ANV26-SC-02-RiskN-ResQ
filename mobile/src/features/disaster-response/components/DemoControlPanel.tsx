/**
 * DemoControlPanel.tsx
 * Development and judging control panel providing interactive scenario triggers.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { RoadStatus } from '../types/types';

interface DemoControlPanelProps {
  roadAStatus: RoadStatus;
  onBlockRoad: () => void;
  onUnblockRoad: () => void;
  onFindAlternativeRoute: () => void;
  onRequestMedicine: () => void;
  onResetDemo: () => void;
}

export const DemoControlPanel: React.FC<DemoControlPanelProps> = ({
  roadAStatus,
  onBlockRoad,
  onUnblockRoad,
  onFindAlternativeRoute,
  onRequestMedicine,
  onResetDemo,
}) => {
  const isRoadABlocked = roadAStatus === 'BLOCKED';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>HACKATHON DEMO CONTROLS</Text>
        <View style={styles.statusIndicator}>
          <Text style={styles.statusLabel}>5th Cross:</Text>
          <View
            style={[
              styles.statusPill,
              isRoadABlocked ? styles.statusPillBlocked : styles.statusPillOpen,
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                isRoadABlocked ? styles.statusPillBlockedText : styles.statusPillOpenText,
              ]}
            >
              {roadAStatus}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.buttonsRow}>
        <TouchableOpacity
          style={[styles.button, isRoadABlocked ? styles.buttonDisabled : styles.buttonDanger]}
          onPress={onBlockRoad}
          disabled={isRoadABlocked}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>BLOCK ROAD A</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, !isRoadABlocked ? styles.buttonDisabled : styles.buttonSuccess]}
          onPress={onUnblockRoad}
          disabled={!isRoadABlocked}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>UNBLOCK ROAD A</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={onFindAlternativeRoute}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>RECALCULATE ROUTE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonTeal]}
          onPress={onRequestMedicine}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonText}>REQUEST MEDICINE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonNeutral]}
          onPress={onResetDemo}
          activeOpacity={0.7}
        >
          <Text style={styles.buttonNeutralText}>RESET DEMO</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A', // Slate 900
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    color: '#94A3B8',
    fontSize: 10,
    marginRight: 6,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  statusPillOpen: {
    backgroundColor: '#064E3B',
  },
  statusPillBlocked: {
    backgroundColor: '#7F1D1D',
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statusPillOpenText: {
    color: '#34D399',
  },
  statusPillBlockedText: {
    color: '#F87171',
  },
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#2563EB',
  },
  buttonDanger: {
    backgroundColor: '#DC2626',
  },
  buttonSuccess: {
    backgroundColor: '#059669',
  },
  buttonTeal: {
    backgroundColor: '#0F766E',
  },
  buttonNeutral: {
    backgroundColor: '#334155',
    borderWidth: 1,
    borderColor: '#475569',
  },
  buttonDisabled: {
    backgroundColor: '#1E293B',
    opacity: 0.5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buttonNeutralText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
