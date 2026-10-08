/**
 * DisasterMapView.tsx
 * Primary mobile map component integrating user location, hazard geofencing,
 * road topology, routing overlays, and community volunteer markers.
 */

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Location, RiskZone as RiskZoneType, Road, RoadGraph, Route, Volunteer } from '../types/types';
import { RiskZoneComponent } from './RiskZone';
import { BlockedRoadComponent } from './BlockedRoad';
import { RouteOverlay } from './RouteOverlay';
import { VolunteerMarker } from './VolunteerMarker';

interface DisasterMapViewProps {
  userLocation: Location;
  riskZones: RiskZoneType[];
  roads: Road[];
  graph: RoadGraph;
  activeRoute: Route | null;
  volunteers: Volunteer[];
  selectedVolunteerId?: string;
  onSelectVolunteer?: (volunteer: Volunteer) => void;
}

export const DisasterMapView: React.FC<DisasterMapViewProps> = ({
  userLocation,
  riskZones,
  roads,
  graph,
  activeRoute,
  volunteers,
  selectedVolunteerId,
  onSelectVolunteer,
}) => {
  const mapRef = useRef<MapView>(null);

  const initialRegion = {
    latitude: userLocation.latitude,
    longitude: userLocation.longitude,
    latitudeDelta: 0.025,
    longitudeDelta: 0.025,
  };

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.025,
          longitudeDelta: 0.025,
        },
        600
      );
    }
  }, [userLocation]);

  const roadMap = new Map<string, Road>();
  for (const r of roads) {
    roadMap.set(r.id, r);
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        provider={PROVIDER_DEFAULT}
        showsUserLocation={false}
        showsCompass={true}
        toolbarEnabled={false}
      >
        {/* 1. FLOOD RISK ZONES (Circle Geofences) */}
        {riskZones.map((zone) => (
          <RiskZoneComponent key={zone.id} zone={zone} />
        ))}

        {/* 2. ROAD NETWORK AND BLOCKED SEGMENTS */}
        {graph.edges.map((edge, index) => {
          const road = roadMap.get(edge.roadId) || {
            id: edge.roadId,
            name: edge.roadId,
            status: 'OPEN' as const,
            reason: null,
          };
          return (
            <BlockedRoadComponent
              key={`${edge.roadId}-${edge.from}-${edge.to}-${index}`}
              road={road}
              edge={edge}
              nodes={graph.nodes}
            />
          );
        })}

        {/* 3. ACTIVE ROUTE POLYLINE (Dijkstra Computed Route) */}
        <RouteOverlay route={activeRoute} />

        {/* 4. VOLUNTEER & RESOURCE MARKERS */}
        {volunteers.map((vol) => (
          <VolunteerMarker
            key={vol.id}
            volunteer={vol}
            userLocation={userLocation}
            isSelected={selectedVolunteerId === vol.id}
            onSelect={onSelectVolunteer}
          />
        ))}

        {/* 5. USER LOCATION PIN */}
        <Marker
          coordinate={{
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
          }}
          title="Current Location"
          description="Your real-time reported position"
          zIndex={20}
        >
          <View style={styles.userPinContainer}>
            <View style={styles.userPinPulse} />
            <View style={styles.userPinCore} />
            <View style={styles.userLabelBadge}>
              <Text style={styles.userLabelText}>YOU</Text>
            </View>
          </View>
        </Marker>

        {/* 6. GRAPH DESTINATION PIN (Hospital / Relief Center D) */}
        {graph.nodes.D && (
          <Marker
            coordinate={{
              latitude: graph.nodes.D.latitude,
              longitude: graph.nodes.D.longitude,
            }}
            title="Relief Station Alpha"
            description="Emergency Destination Hub"
            zIndex={12}
          >
            <View style={styles.destPinContainer}>
              <Text style={styles.destPinText}>RELIEF CTR</Text>
            </View>
          </Marker>
        )}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E2E8F0',
  },
  userPinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
  },
  userPinPulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(37, 99, 235, 0.25)',
  },
  userPinCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#2563EB',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  userLabelBadge: {
    backgroundColor: '#1E40AF',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
  },
  userLabelText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  destPinContainer: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#10B981',
    elevation: 3,
  },
  destPinText: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
