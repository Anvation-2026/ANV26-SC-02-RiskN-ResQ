/**
 * MatchResultCard.tsx
 * Professional card displaying volunteer and resource matching outcomes with explainable scoring.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MatchResult } from '../types/types';
import { formatDistance } from '../utils/distance';

interface MatchResultCardProps {
  result: MatchResult | null;
  onDismiss?: () => void;
}

export const MatchResultCard: React.FC<MatchResultCardProps> = ({ result }) => {
  if (!result) {
    return null;
  }

  if (!result.matched) {
    return (
      <View style={[styles.card, styles.noMatchCard]}>
        <View style={styles.badgeRow}>
          <View style={styles.noMatchBadge}>
            <Text style={styles.noMatchBadgeText}>NO MATCH FOUND</Text>
          </View>
        </View>
        <Text style={styles.noMatchMessage}>{result.message}</Text>
      </View>
    );
  }

  const { volunteer, resource, distanceKm, matchScore, scoreBreakdown } = result;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badgeRow}>
          <View style={styles.matchedBadge}>
            <Text style={styles.matchedBadgeText}>VOLUNTEER FOUND</Text>
          </View>
        </View>

        <View style={styles.scoreContainer}>
          <Text style={styles.scoreValue}>{matchScore}</Text>
          <Text style={styles.scoreLabel}>MATCH SCORE</Text>
        </View>
      </View>

      <View style={styles.detailsContainer}>
        <View style={styles.volunteerInfo}>
          <Text style={styles.volunteerName}>{volunteer.name.toUpperCase()}</Text>
          <Text style={styles.resourceTag}>Resource: {resource}</Text>
        </View>

        <View style={styles.proximityBadge}>
          <Text style={styles.proximityText}>{formatDistance(distanceKm)} away</Text>
        </View>
      </View>

      {scoreBreakdown && (
        <View style={styles.breakdownContainer}>
          <Text style={styles.breakdownTitle}>SCORING CRITERIA:</Text>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownItem}>
              Resource: <Text style={styles.breakdownNumber}>+{scoreBreakdown.resourceCompatibility}</Text>
            </Text>
            <Text style={styles.breakdownItem}>
              Availability: <Text style={styles.breakdownNumber}>+{scoreBreakdown.availabilityScore}</Text>
            </Text>
            <Text style={styles.breakdownItem}>
              Proximity: <Text style={styles.breakdownNumber}>+{scoreBreakdown.distanceScore}</Text>
            </Text>
            <Text style={styles.breakdownItem}>
              Priority: <Text style={styles.breakdownNumber}>+{scoreBreakdown.priorityScore}</Text>
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  noMatchCard: {
    borderColor: '#FED7AA',
    backgroundColor: '#FFFBEB',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flex: 1,
  },
  matchedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  matchedBadgeText: {
    color: '#065F46',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  noMatchBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  noMatchBadgeText: {
    color: '#92400E',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  scoreContainer: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scoreValue: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: '800',
  },
  scoreLabel: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  volunteerInfo: {
    flex: 1,
  },
  volunteerName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  resourceTag: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  proximityBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  proximityText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  breakdownContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  breakdownTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  breakdownItem: {
    fontSize: 10,
    color: '#475569',
  },
  breakdownNumber: {
    fontWeight: '700',
    color: '#0F766E',
  },
  noMatchMessage: {
    marginTop: 8,
    color: '#78350F',
    fontSize: 12,
    fontWeight: '500',
  },
});
