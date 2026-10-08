/**
 * BlockedRoad.tsx
 * Visual representation of roads and blockage incidents on the map.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Polyline, Marker } from 'react-native-maps';
import { Road, RoadEdge, RoadNode } from '../types/types';

interface BlockedRoadProps {
  road: Road;
  edge: RoadEdge;
  nodes: Record<string, RoadNode>;
}

export const BlockedRoadComponent: React.FC<BlockedRoadProps> = ({ road, edge, nodes }) => {
  const fromNode = nodes[edge.from];
  const toNode = nodes[edge.to];

  if (!fromNode || !toNode) {
    return null;
  }

  const coordinates = [
    { latitude: fromNode.latitude, longitude: fromNode.longitude },
    { latitude: toNode.latitude, longitude: toNode.longitude },
  ];

  const isBlocked = road.status === 'BLOCKED' || edge.blocked;
  const strokeColor = isBlocked ? '#DC2626' : '#94A3B8';
  const strokeWidth = isBlocked ? 4 : 2;

  // Midpoint for the incident badge marker
  const midLat = (fromNode.latitude + toNode.latitude) / 2;
  const midLon = (fromNode.longitude + toNode.longitude) / 2;

  return (
    <>
      <Polyline
        coordinates={coordinates}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        lineDashPattern={isBlocked ? [6, 4] : undefined}
        zIndex={isBlocked ? 4 : 2}
      />
      {isBlocked && (
        <Marker
          coordinate={{ latitude: midLat, longitude: midLon }}
          title={`BLOCKED: ${road.name}`}
          description={road.reason || 'Road impassable due to incident'}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={10}
        >
          <View style={styles.blockBadge}>
            <Text style={styles.blockBadgeText}>BLOCKED</Text>
          </View>
        </Marker>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  blockBadge: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  blockBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
