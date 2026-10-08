/**
 * mockHazards.ts
 * Flood risk zones and hazard geofence datasets for Bengaluru central area.
 */

import { RiskZone } from '../types/types';

export const MOCK_RISK_ZONES: RiskZone[] = [
  {
    id: 'FLOOD_ZONE_01',
    type: 'FLOOD',
    name: 'Cubbon Park - MG Road Lowland Basin',
    latitude: 12.9725,
    longitude: 77.5960,
    radiusKm: 2.0,
    riskLevel: 'HIGH',
    description: 'Critical urban flooding threat due to storm runoff accumulation and drain overflow.',
  },
  {
    id: 'FLOOD_ZONE_02',
    type: 'FLOOD',
    name: 'Ulsoor Catchment Buffer Zone',
    latitude: 12.9830,
    longitude: 77.6200,
    radiusKm: 1.5,
    riskLevel: 'MODERATE',
    description: 'Moderate waterlogging risk observed near stormwater channels.',
  },
];

export const PRIMARY_DEMO_RISK_ZONE: RiskZone = MOCK_RISK_ZONES[0];
