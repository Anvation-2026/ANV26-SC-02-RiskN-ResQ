/**
 * FallbackWebMap.tsx
 * Resilient vector-based geospatial visualizer used when running on React Native Web
 * or in headless test environments where native react-native-maps binaries are unavailable.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, DimensionValue, ViewStyle } from 'react-native';
import { Location, RiskZone, Road, RoadGraph, Route, Volunteer } from '../types/types';
import { getRiskLevelColor } from '../services/geofencing';
import { formatDistance, calculateDistanceKm } from '../utils/distance';

interface FallbackWebMapProps {
  userLocation: Location;
  riskZones: RiskZone[];
  roads: Road[];
  graph: RoadGraph;
  activeRoute: Route | null;
  volunteers: Volunteer[];
  selectedVolunteerId?: string;
  onSelectVolunteer?: (volunteer: Volunteer) => void;
}

export const FallbackWebMap: React.FC<FallbackWebMapProps> = ({
  userLocation,
  riskZones,
  roads,
  graph,
  activeRoute,
  volunteers,
  selectedVolunteerId,
  onSelectVolunteer,
}) => {
  // Normalize geo-coordinates into relative percentages (0-100%) for canvas view
  // Demo area bounds: lat 12.965 to 12.980, lon 77.590 to 77.610
  const minLat = 12.964;
  const maxLat = 12.980;
  const minLon = 77.590;
  const maxLon = 77.610;

  const toPercent = (lat: number, lon: number): { left: DimensionValue; top: DimensionValue } => {
    const x = Math.max(5, Math.min(95, ((lon - minLon) / (maxLon - minLon)) * 100));
    // Invert latitude for screen Y
    const y = Math.max(5, Math.min(95, (1 - (lat - minLat) / (maxLat - minLat)) * 100));
    return { left: `${x}%`, top: `${y}%` };
  };

  const roadMap = new Map<string, Road>();
  for (const r of roads) roadMap.set(r.id, r);

  const primaryZone = riskZones[0];
  const zoneColors = primaryZone ? getRiskLevelColor(primaryZone.riskLevel) : null;

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          GEOSPATIAL SIMULATION GRID (BENGALURU CENTRAL DEMO CORRIDOR)
        </Text>
      </View>

      <View style={styles.canvas}>
        {/* Risk Zone Circle Representation */}
        {primaryZone && zoneColors && (
          <View
            style={[
              styles.riskZoneOverlay,
              {
                backgroundColor: zoneColors.fillColor,
                borderColor: zoneColors.strokeColor,
                ...toPercent(primaryZone.latitude, primaryZone.longitude),
              } as ViewStyle,
            ]}
          >
            <Text style={[styles.zoneBadge, { color: zoneColors.badgeText }]}>
              FLOOD RISK ZONE: {primaryZone.riskLevel}
            </Text>
          </View>
        )}

        {/* Road Graph Nodes */}
        {Object.values(graph.nodes).map((node) => {
          const pos = toPercent(node.latitude, node.longitude);
          const isOrigin = node.id === 'A';
          const isDest = node.id === 'D';
          const isOnActiveRoute = activeRoute?.nodes.includes(node.id);

          return (
            <View
              key={node.id}
              style={[
                styles.nodeMarker,
                pos as any,
                isOnActiveRoute && styles.nodeOnRoute,
                isOrigin && styles.nodeOrigin,
                isDest && styles.nodeDest,
              ]}
            >
              <Text style={styles.nodeText}>{node.id}</Text>
            </View>
          );
        })}

        {/* Volunteers */}
        {volunteers.map((vol) => {
          const pos = toPercent(vol.latitude, vol.longitude);
          const isSelected = selectedVolunteerId === vol.id;
          const dist = calculateDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            vol.latitude,
            vol.longitude
          );

          return (
            <TouchableOpacity
              key={vol.id}
              style={[
                styles.volunteerMarker,
                pos as any,
                isSelected && styles.volunteerSelected,
              ]}
              onPress={() => onSelectVolunteer?.(vol)}
            >
              <View style={styles.volunteerBadge}>
                <Text style={styles.volunteerBadgeText}>{vol.name}</Text>
                <Text style={styles.volunteerSubText}>
                  {vol.resource} ({formatDistance(dist)})
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* User Marker */}
        <View style={[styles.userMarker, toPercent(userLocation.latitude, userLocation.longitude) as any]}>
          <View style={styles.userDot} />
          <Text style={styles.userLabel}>YOU</Text>
        </View>
      </View>

      {/* Corridor Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#2563EB' }]} />
          <Text style={styles.legendText}>
            Route: {activeRoute?.nodes.join(' → ') || 'None'}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#DC2626' }]} />
          <Text style={styles.legendText}>
            5th Cross:{' '}
            {roads.find((r) => r.id === 'ROAD_A')?.status === 'BLOCKED' ? 'BLOCKED' : 'OPEN'}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  banner: {
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  bannerText: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  canvas: {
    flex: 1,
    position: 'relative',
    margin: 12,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  riskZoneOverlay: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    transform: [{ translateX: -110 }, { translateY: -110 }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBadge: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  nodeMarker: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#334155',
    borderWidth: 2,
    borderColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -13 }, { translateY: -13 }],
    zIndex: 5,
  },
  nodeOnRoute: {
    backgroundColor: '#1D4ED8',
    borderColor: '#93C5FD',
  },
  nodeOrigin: {
    backgroundColor: '#047857',
    borderColor: '#6EE7B7',
  },
  nodeDest: {
    backgroundColor: '#B91C1C',
    borderColor: '#FCA5A5',
  },
  nodeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  volunteerMarker: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 8,
  },
  volunteerSelected: {
    zIndex: 12,
  },
  volunteerBadge: {
    backgroundColor: '#0F766E',
    borderWidth: 1,
    borderColor: '#2DD4BF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  volunteerBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  volunteerSubText: {
    color: '#CCFBF1',
    fontSize: 8,
  },
  userMarker: {
    position: 'absolute',
    alignItems: 'center',
    transform: [{ translateX: -12 }, { translateY: -12 }],
    zIndex: 15,
  },
  userDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userLabel: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColor: {
    width: 8,
    height: 8,
    borderRadius: 2,
    marginRight: 6,
  },
  legendText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
});
