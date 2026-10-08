// Auth, admin and volunteer API calls. These talk to the live backend only (no demo fallback):
// signing in, managing volunteers or changing roads must never be faked.
import { http } from './api';

// ── auth ──
export const apiLogin = (email, password) => http('/auth/login', { method: 'POST', body: { email, password } });
export const apiRegister = (payload) => http('/auth/register', { method: 'POST', body: payload });
export const apiMe = () => http('/auth/me');
export const apiLogout = () => http('/auth/logout', { method: 'POST' });

// ── volunteer (own account) ──
export const getMyVolunteer = () => http('/volunteers/me');
export const patchMyVolunteer = (body) => http('/volunteers/me', { method: 'PATCH', body });
export const getMyRequests = () => http('/volunteers/me/requests');
export const acceptMatch = (id) => http(`/matches/${id}/accept`, { method: 'POST' });
export const completeMatch = (id) => http(`/matches/${id}/complete`, { method: 'POST' });

// ── super admin ──
export const getAdminSummary = () => http('/admin/summary');
export const getAdminUsers = () => http('/admin/users');
export const setUserActive = (id, is_active) => http(`/admin/users/${id}`, { method: 'PATCH', body: { is_active } });
export const getVolunteersFull = () => http('/volunteers');
export const createVolunteer = (body) => http('/volunteers', { method: 'POST', body });
export const updateVolunteer = (id, body) => http(`/volunteers/${id}`, { method: 'PUT', body });
export const disableVolunteer = (id) => http(`/volunteers/${id}`, { method: 'DELETE' });
export const getAllIncidents = () => http('/incidents');
export const setIncident = (id, action) => http(`/incidents/${id}/${action}`, { method: 'POST' });
export const getAllRoads = () => http('/roads');
export const setRoad = (id, blocked) => http(`/roads/${id}/${blocked ? 'block' : 'unblock'}`, { method: 'POST' });
export const simulateRain = (rainfall) => http('/simulate-hazard', { method: 'POST', body: { hazard: 'FLOOD', rainfall } });
export const resetDemo = () => http('/reset', { method: 'POST' });
export const getActiveAlerts = () => http('/alerts?active_only=true');
export const getHelpRequests = () => http('/help-requests');
export const getMatches = () => http('/matches');
