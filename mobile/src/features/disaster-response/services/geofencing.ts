/**
 * geofencing.ts
 * Flood risk evaluation and circular geofence boundary detection.
 */

import { Location, RiskAssessment, RiskLevel, RiskZone } from '../types/types';
import { calculateDistanceKm } from '../utils/distance';

/**
 * Evaluates whether a given geographic coordinate lies within a designated hazard risk zone.
 *
 * @param userLocation - Current coordinates of the user/device
 * @param riskZone - Defined hazard zone with center coordinates and radius
 * @returns RiskAssessment object with containment status, distance to center, and risk level
 */
export function isInsideRiskZone(
  userLocation: Location,
  riskZone: RiskZone
): RiskAssessment {
  const distanceKm = calculateDistanceKm(
    userLocation.latitude,
    userLocation.longitude,
    riskZone.latitude,
    riskZone.longitude
  );

  const insideRiskZone = distanceKm <= riskZone.radiusKm;

  return {
    insideRiskZone,
    distanceKm,
    riskLevel: insideRiskZone ? riskZone.riskLevel : 'LOW',
  };
}

/**
 * Evaluates user location against multiple active disaster zones,
 * returning the highest severity assessment.
 */
export function assessMultipleRiskZones(
  userLocation: Location,
  riskZones: RiskZone[]
): RiskAssessment {
  if (!riskZones || riskZones.length === 0) {
    return {
      insideRiskZone: false,
      distanceKm: 0,
      riskLevel: 'LOW',
    };
  }

  const priorityOrder: Record<RiskLevel, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MODERATE: 2,
    LOW: 1,
  };

  let highestAssessment: RiskAssessment = {
    insideRiskZone: false,
    distanceKm: Number.POSITIVE_INFINITY,
    riskLevel: 'LOW',
  };

  for (const zone of riskZones) {
    const assessment = isInsideRiskZone(userLocation, zone);
    if (assessment.insideRiskZone) {
      if (
        !highestAssessment.insideRiskZone ||
        priorityOrder[assessment.riskLevel] > priorityOrder[highestAssessment.riskLevel] ||
        assessment.distanceKm < highestAssessment.distanceKm
      ) {
        highestAssessment = assessment;
      }
    } else if (!highestAssessment.insideRiskZone && assessment.distanceKm < highestAssessment.distanceKm) {
      highestAssessment = assessment;
    }
  }

  return highestAssessment;
}

/**
 * Returns UI color tokens for visual hierarchy:
 * LOW: green/neutral
 * MODERATE: yellow
 * HIGH: orange
 * CRITICAL: red
 */
export function getRiskLevelColor(riskLevel: RiskLevel): {
  strokeColor: string;
  fillColor: string;
  badgeBg: string;
  badgeText: string;
} {
  switch (riskLevel) {
    case 'CRITICAL':
      return {
        strokeColor: 'rgba(220, 38, 38, 0.85)',
        fillColor: 'rgba(239, 68, 68, 0.25)',
        badgeBg: '#FEE2E2',
        badgeText: '#991B1B',
      };
    case 'HIGH':
      return {
        strokeColor: 'rgba(234, 88, 12, 0.85)',
        fillColor: 'rgba(249, 115, 22, 0.25)',
        badgeBg: '#FFEDD5',
        badgeText: '#9A3412',
      };
    case 'MODERATE':
      return {
        strokeColor: 'rgba(202, 138, 4, 0.85)',
        fillColor: 'rgba(234, 179, 8, 0.25)',
        badgeBg: '#FEF9C3',
        badgeText: '#854D0E',
      };
    case 'LOW':
    default:
      return {
        strokeColor: 'rgba(22, 163, 74, 0.85)',
        fillColor: 'rgba(34, 197, 94, 0.20)',
        badgeBg: '#DCFCE7',
        badgeText: '#166534',
      };
  }
}
