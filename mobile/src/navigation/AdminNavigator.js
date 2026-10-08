import React from 'react';
import TabShell from './TabShell';
import AdminDashboard from '../screens/admin/AdminDashboard';
import AdminPeople from '../screens/admin/AdminPeople';
import AdminIncidents from '../screens/admin/AdminIncidents';
import AdminControl from '../screens/admin/AdminControl';
import AdminRequests from '../screens/admin/AdminRequests';

const TABS = [
  { key: 'Dashboard', label: 'Dashboard', icon: 'grid', Screen: AdminDashboard },
  { key: 'People', label: 'People', icon: 'users', Screen: AdminPeople },
  { key: 'Incidents', label: 'Incidents', icon: 'alert-triangle', Screen: AdminIncidents },
  { key: 'Control', label: 'Control', icon: 'sliders', Screen: AdminControl },
  { key: 'Requests', label: 'Requests', icon: 'inbox', Screen: AdminRequests },
];

export default function AdminNavigator() {
  return <TabShell tabs={TABS} />;
}
