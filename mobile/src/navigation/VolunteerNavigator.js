import React from 'react';
import { VolunteerProvider, useVolunteer } from '../context/VolunteerContext';
import TabShell from './TabShell';
import LocationGate from '../components/LocationGate';
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
  const v = useVolunteer();
  // The Requests tab shows a badge while an assignment the volunteer has not looked at yet is waiting.
  return (
    <>
      <TabShell tabs={TABS} badges={{ Requests: v.newIds.length }} onTabChange={(k) => k === 'Requests' && v.markSeen()} />
      {v.showLocationGate ? (
        <LocationGate state={v.locationState} role="volunteer" busy={v.locBusy} onAllow={v.askLocation} onLater={v.dismissLocationGate} onSettings={v.openLocationSettings} onRetry={v.retryLocation} />
      ) : null}
    </>
  );
}

export default function VolunteerNavigator() {
  return (
    <VolunteerProvider>
      <Tabs />
    </VolunteerProvider>
  );
}
