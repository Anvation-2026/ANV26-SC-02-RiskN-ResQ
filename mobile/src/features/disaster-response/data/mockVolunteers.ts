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
    latitude: 12.9765,
    longitude: 77.6050, // Corresponds to Node D (Relief Station Alpha)
    availability: 'AVAILABLE',
    phone: '+91 98450 12345',
  },
  {
    id: 'VOL002',
    name: 'Rahul',
    resource: 'Food',
    latitude: 12.9750,
    longitude: 77.6015, // Corresponds to Node C (Church Street Intersection)
    availability: 'AVAILABLE',
    phone: '+91 98450 23456',
  },
  {
    id: 'VOL003',
    name: 'Priya',
    resource: 'First Aid',
    latitude: 12.9675,
    longitude: 77.5995, // Corresponds to Node E (Brigade South Waypoint)
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
    latitude: 12.9700,
    longitude: 77.6065, // Corresponds to Node F (Richmond Outer Bypass)
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
