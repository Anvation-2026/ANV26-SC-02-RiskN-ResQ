/**
 * RouteInfoCard.tsx
 * Compact emergency navigation card displaying active route metrics and hazard avoidance notes.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Route } from '../types/types';

interface RouteInfoCardProps {
  route: Route | null;
}

export const RouteInfoCard: React.FC<RouteInfoCardProps> = ({ route }) => {
  if (!route) {
    return null;
  }

  const isAlternative = route.blockedRoads.length > 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.routeBadge,
              isAlternative ? styles.alternativeBadge : styles.primaryBadge,
            ]}
          >
            <Text
              style={[
                styles.routeBadgeText,
                isAlternative ? styles.alternativeBadgeText : styles.primaryBadgeText,
              ]}
            >
              {isAlternative ? 'RECOMMENDED ALTERNATIVE' : 'PRIMARY DIRECT ROUTE'}
            </Text>
          </View>
        </View>

        <View style={styles.metricsContainer}>
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{route.distanceKm.toFixed(1)} km</Text>
            <Text style={styles.metricLabel}>DISTANCE</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.metricItem}>
            <Text style={styles.metricValue}>{route.etaMinutes} min</Text>
            <Text style={styles.metricLabel}>EST. TIME</Text>
          </View>
        </View>
      </View>

      {/* Incident / Blocked Road Notice */}
      {isAlternative && (
        <View style={styles.hazardNoticeBox}>
          <Text style={styles.hazardNoticeHeader}>ROAD BLOCKED</Text>
          <Text style={styles.hazardNoticeBody}>
            {route.blockedRoads.map((r) => r.name).join(', ')}
          </Text>
          <Text style={styles.hazardNoticeReason}>Reason: {route.reason}</Text>
        </View>
      )}

      {/* Route Waypoints */}
      <View style={styles.nodesContainer}>
        <Text style={styles.nodesLabel}>CORRIDOR:</Text>
        <Text style={styles.nodesPath}>{route.nodes.join(' → ')}</Text>
      </View>

      {/* Mandatory Safety Notice */}
      <View style={styles.safetyBox}>
        <Text style={styles.safetyNote}>{route.safetyNote}</Text>
      </View>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeRow: {
    flex: 1,
  },
  routeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
  },
  routeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  primaryBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  primaryBadgeText: {
    color: '#065F46',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  alternativeBadge: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  alternativeBadgeText: {
    color: '#1E40AF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricItem: {
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  metricLabel: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
  },
  metricDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 8,
  },
  hazardNoticeBox: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 3,
    borderLeftColor: '#DC2626',
    padding: 8,
    borderRadius: 4,
    marginBottom: 10,
  },
  hazardNoticeHeader: {
    color: '#991B1B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  hazardNoticeBody: {
    color: '#7F1D1D',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 1,
  },
  hazardNoticeReason: {
    color: '#B91C1C',
    fontSize: 11,
    marginTop: 2,
  },
  nodesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  nodesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginRight: 6,
  },
  nodesPath: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    letterSpacing: 0.5,
  },
  safetyBox: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  safetyNote: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
  },
});
