/**
 * RiskZone.tsx
 * Map overlay component rendering circular geofenced hazard zones with risk-scaled styling.
 */

import React from 'react';
import { Circle } from 'react-native-maps';
import { RiskZone as RiskZoneType } from '../types/types';
import { getRiskLevelColor } from '../services/geofencing';

interface RiskZoneProps {
  zone: RiskZoneType;
}

export const RiskZoneComponent: React.FC<RiskZoneProps> = ({ zone }) => {
  const colors = getRiskLevelColor(zone.riskLevel);
  const radiusMeters = zone.radiusKm * 1000;

  return (
    <Circle
      center={{
        latitude: zone.latitude,
        longitude: zone.longitude,
      }}
      radius={radiusMeters}
      strokeColor={colors.strokeColor}
      fillColor={colors.fillColor}
      strokeWidth={2}
      zIndex={1}
    />
  );
};
