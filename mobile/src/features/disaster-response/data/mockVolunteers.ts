/**
 * mockVolunteers.ts
 * Community responder dataset for resource matching and geospatial overlay.
 */

import { Volunteer } from '../types/types';

export const MOCK_VOLUNTEERS: Volunteer[] = [
  {
    id: 'VOL001',
    name: 'Arjun',
    resource: 'Medicine',
    latitude: 12.9710,
    longitude: 77.5935,
    availability: 'AVAILABLE',
    phone: '+91 98450 12345',
  },
  {
    id: 'VOL002',
    name: 'Rahul',
    resource: 'Food',
    latitude: 12.9750,
    longitude: 77.6000,
    availability: 'AVAILABLE',
    phone: '+91 98450 23456',
  },
  {
    id: 'VOL003',
    name: 'Priya',
    resource: 'First Aid',
    latitude: 12.9690,
    longitude: 77.5920,
    availability: 'AVAILABLE',
    phone: '+91 98450 34567',
  },
  {
    id: 'VOL004',
    name: 'Ananya',
    resource: 'Medicine',
    latitude: 12.9780,
    longitude: 77.6050,
    availability: 'UNAVAILABLE',
    phone: '+91 98450 45678',
  },
  {
    id: 'VOL005',
    name: 'Kiran',
    resource: 'Water',
    latitude: 12.9730,
    longitude: 77.5960,
    availability: 'AVAILABLE',
    phone: '+91 98450 56789',
  },
  {
    id: 'VOL006',
    name: 'Suresh',
    resource: 'Medicine',
    latitude: 12.9900,
    longitude: 77.6300,
    availability: 'AVAILABLE',
    phone: '+91 98450 67890',
  },
];
