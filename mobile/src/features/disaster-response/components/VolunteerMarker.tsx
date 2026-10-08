/**
 * VolunteerMarker.tsx
 * Custom map marker rendering available volunteers and emergency supplies.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Callout } from 'react-native-maps';
import { Volunteer, Location } from '../types/types';
import { calculateDistanceKm, formatDistance } from '../utils/distance';

interface VolunteerMarkerProps {
  volunteer: Volunteer;
  userLocation?: Location;
  isSelected?: boolean;
  onSelect?: (volunteer: Volunteer) => void;
}

export const VolunteerMarker: React.FC<VolunteerMarkerProps> = ({
  volunteer,
  userLocation,
  isSelected,
  onSelect,
}) => {
  const distanceKm = userLocation
    ? calculateDistanceKm(
        userLocation.latitude,
        userLocation.longitude,
        volunteer.latitude,
        volunteer.longitude
      )
    : undefined;

  const distanceText = distanceKm !== undefined ? `${formatDistance(distanceKm)} away` : '';

  return (
    <Marker
      coordinate={{
        latitude: volunteer.latitude,
        longitude: volunteer.longitude,
      }}
      onPress={() => onSelect?.(volunteer)}
      zIndex={isSelected ? 15 : 8}
    >
      <View style={[styles.markerContainer, isSelected && styles.selectedMarker]}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{volunteer.resource.toUpperCase()}</Text>
        </View>
        <View style={styles.pinPoint} />
      </View>

      <Callout tooltip>
        <View style={styles.calloutCard}>
          <Text style={styles.calloutName}>{volunteer.name.toUpperCase()}</Text>
          <Text style={styles.calloutResource}>{volunteer.resource}</Text>
          {distanceText ? <Text style={styles.calloutDistance}>{distanceText}</Text> : null}
          <View style={styles.availabilityRow}>
            <View
              style={[
                styles.statusDot,
                volunteer.availability === 'AVAILABLE' ? styles.statusAvailable : styles.statusUnavailable,
              ]}
            />
            <Text style={styles.calloutStatus}>{volunteer.availability}</Text>
          </View>
        </View>
      </Callout>
    </Marker>
  );
};

const styles = StyleSheet.create({
  markerContainer: {
    alignItems: 'center',
  },
  selectedMarker: {
    transform: [{ scale: 1.15 }],
  },
  badge: {
    backgroundColor: '#0F766E', // Rescue Teal
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pinPoint: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 0,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#0F766E',
  },
  calloutCard: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    minWidth: 140,
  },
  calloutName: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  calloutResource: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  calloutDistance: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 4,
  },
  availabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusAvailable: {
    backgroundColor: '#22C55E',
  },
  statusUnavailable: {
    backgroundColor: '#EF4444',
  },
  calloutStatus: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
