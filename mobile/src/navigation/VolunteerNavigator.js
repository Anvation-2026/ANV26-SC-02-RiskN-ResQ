import React from 'react';
import { VolunteerProvider, useVolunteer } from '../context/VolunteerContext';
import TabShell from './TabShell';
import VolunteerHome from '../screens/volunteer/VolunteerHome';
import VolunteerRequests from '../screens/volunteer/VolunteerRequests';
import VolunteerNearby from '../screens/volunteer/VolunteerNearby';
import VolunteerMap from '../screens/volunteer/VolunteerMap';
import VolunteerAccount from '../screens/volunteer/VolunteerAccount';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home', Screen: VolunteerHome },
  { key: 'Requests', label: 'Requests', icon: 'inbox', Screen: VolunteerRequests },
  { key: 'Nearby', label: 'Nearby', icon: 'crosshair', Screen: VolunteerNearby },
  { key: 'Map', label: 'Map', icon: 'map', Screen: VolunteerMap },
  { key: 'Account', label: 'Account', icon: 'user', Screen: VolunteerAccount },
];

function Tabs() {
  const { newIds, markSeen } = useVolunteer();
  // The Requests tab shows a badge while an assignment the volunteer has not looked at yet is waiting.
  return <TabShell tabs={TABS} badges={{ Requests: newIds.length }} onTabChange={(k) => k === 'Requests' && markSeen()} />;
}

export default function VolunteerNavigator() {
  return (
    <VolunteerProvider>
      <Tabs />
    </VolunteerProvider>
  );
}
