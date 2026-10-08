import React from 'react';
import TabShell from './TabShell';
import AdminDashboard from '../screens/admin/AdminDashboard';
import AdminPeople from '../screens/admin/AdminPeople';
import AdminIncidents from '../screens/admin/AdminIncidents';
import AdminControl from '../screens/admin/AdminControl';
import AdminRequests from '../screens/admin/AdminRequests';
import AdminInsights from '../screens/admin/AdminInsights';
import AdminIntel from '../screens/admin/AdminIntel';

const TABS = [
  { key: 'Dashboard', label: 'Dashboard', icon: 'grid', Screen: AdminDashboard },
  { key: 'People', label: 'People', icon: 'users', Screen: AdminPeople },
  { key: 'Incidents', label: 'Incidents', icon: 'alert-triangle', Screen: AdminIncidents },
  { key: 'Control', label: 'Control', icon: 'sliders', Screen: AdminControl },
  { key: 'Requests', label: 'Requests', icon: 'inbox', Screen: AdminRequests },
  { key: 'Intel', label: 'Intelligence', icon: 'cloud-rain', Screen: AdminIntel },
  { key: 'Insights', label: 'Insights', icon: 'bar-chart-2', Screen: AdminInsights },
];

export default function AdminNavigator() {
  return <TabShell tabs={TABS} />;
}
