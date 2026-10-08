import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import MapView from '../../components/MapView';
import ErrorBoundary from '../../components/ErrorBoundary';
import { Card, ErrorText } from '../../components/ui';
import { PRIORITY_COLOR } from '../../components/RequestCards';
import { useVolunteer } from '../../context/VolunteerContext';
import usePolling from '../../hooks/usePolling';
import { computeRoute, getRoadStatus } from '../../services/api';
import { VOLUNTEER_ROUTE_NOTE } from '../../services/copy';
import { formatDistance } from '../../features/disaster-response/utils/distance';
import { prettyResource } from '../../integration/volunteerAdapter';
import { colors, fonts } from '../../theme';

const ok = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng);

export default function VolunteerMap({ params }) {
  const { volunteer, reqs } = useVolunteer();
  const roads = usePolling(getRoadStatus, 15000);
  const [selectedId, setSelectedId] = useState(null);
  const [route, setRoute] = useState(null);
  const [routing, setRouting] = useState(false);

  useEffect(() => { if (params && params.requestId) setSelectedId(params.requestId); }, [params]);

  const me = volunteer && ok(volunteer.latitude, volunteer.longitude) ? { latitude: volunteer.latitude, longitude: volunteer.longitude } : null;
  const requests = useMemo(() => [...reqs.assigned, ...reqs.nearby_open].filter((r) => ok(r.latitude, r.longitude)), [reqs]);
  const selected = requests.find((r) => r.request_id === selectedId) || null;

  // Route to the selected request using the app's existing incident-aware routing (blocked roads are avoided there).
  useEffect(() => {
    setRoute(null);
    if (!me || !selected) return;
    let live = true;
    setRouting(true);
    computeRoute(me, { latitude: selected.latitude, longitude: selected.longitude })
      .then((res) => {
        if (!live) return;
        if (res && res.success) {
          setRoute({ ok: true, km: res.distanceKm, min: res.etaMinutes, line: res.polyline || [],
            avoided: (res.avoidedIncidents || []).map((i) => i.description || i.type) });
        } else setRoute({ ok: false, reason: (res && res.message) || 'No route found.' });
      })
      .catch(() => live && setRoute({ ok: false, reason: 'The route service could not be reached. Try again later.' }))
      .finally(() => live && setRouting(false));
    return () => { live = false; };
  }, [me && me.latitude, me && me.longitude, selected && selected.request_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markers = requests.map((r) => ({
    id: String(r.request_id), latitude: r.latitude, longitude: r.longitude,
    highlight: r.request_id === selectedId || r.priority === 'HIGH' || r.priority === 'CRITICAL',
    label: `${r.priority === 'CRITICAL' || r.priority === 'HIGH' ? '🚨 ' : ''}${prettyResource(r.type)} · ${r.priority}`,
    color: PRIORITY_COLOR[r.priority] || colors.muted,
  }));
  const roadList = Array.isArray(roads.data) ? roads.data : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Map" subtitle="Your location and help requests" />
      <ScrollView contentContainerStyle={s.body}>
        {!me && <Card><Text style={s.warn}>Location unavailable. Requests are still shown; update your location from the Home tab.</Text></Card>}
        <ErrorText>{roads.error}</ErrorText>
        <ErrorBoundary fallbackTitle="Map View Unavailable">
          <View style={s.mapWrap}>
            <MapView
              roads={roadList}
              blocked={roadList.filter((r) => r.status === 'BLOCKED')}
              height={340}
              user={me || undefined}
              markers={markers}
              routeLine={route && route.ok && route.line.length > 1 ? route.line : undefined}
              labelBlockedOnly
            />
          </View>
        </ErrorBoundary>

        <Text style={s.section}>Requests on the map</Text>
        {requests.length === 0 ? <Card><Text style={s.hint}>No assigned or nearby requests to show.</Text></Card> : requests.map((r) => (
          <Pressable key={r.request_id} onPress={() => setSelectedId(r.request_id === selectedId ? null : r.request_id)}
            style={[s.row, r.request_id === selectedId && s.rowOn]}>
            <View style={[s.pip, { backgroundColor: PRIORITY_COLOR[r.priority] || colors.muted }]} />
            <Text style={s.rowText}>{prettyResource(r.type)} · {r.priority}{r.distance_km != null ? ` · ${formatDistance(r.distance_km)}` : ''}</Text>
          </Pressable>
        ))}

        {selected && (
          <Card style={{ marginTop: 12 }}>
            <Text style={s.section}>Route to {prettyResource(selected.type)} request</Text>
            {!me ? <Text style={s.hint}>Add your location to calculate a route.</Text>
              : routing ? <Text style={s.hint}>Calculating route…</Text>
              : route && route.ok ? (
                <>
                  <Text style={s.big}>{route.km.toFixed(1)} km · {route.min} min</Text>
                  {route.avoided.length > 0 && <Text style={s.hint}>Avoids reported blockage: {route.avoided.join(', ')}</Text>}
                </>
              ) : <Text style={s.warn}>{route ? route.reason : 'No route yet.'}</Text>}
            <Text style={s.note}>{VOLUNTEER_ROUTE_NOTE}</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  mapWrap: { borderRadius: 18, overflow: 'hidden', marginBottom: 6 },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
  pip: { width: 12, height: 12, borderRadius: 6 },
  rowText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text, flexShrink: 1 },
  big: { fontFamily: fonts.extrabold, fontSize: 22, color: colors.route },
  hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 4 },
  warn: { fontFamily: fonts.semibold, fontSize: 13, color: '#B45309', lineHeight: 19 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 10 },
});
