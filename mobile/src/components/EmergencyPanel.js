import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { getNearestEvacuation } from '../services/api';
import { topSignals } from './RiskExplainer';
import { fonts } from '../theme';

// Emergency mode for HIGH / CRITICAL risk where the person is. Calm and readable: no animation, large text, the risk is
// written out (never colour alone), and the next actions come first. Every value comes from the backend.
const CALLS = [['112', 'Emergency'], ['108', 'Ambulance'], ['1070', 'Disaster helpline']];

export default function EmergencyPanel({ risk, locationLabel, userLocation, navigate }) {
  const [evac, setEvac] = useState(null);
  const [evacError, setEvacError] = useState(false);
  const level = risk.level;
  const drill = !!risk.drill;
  const critical = level === 'CRITICAL';

  // the nearest designated point is looked up once when emergency mode opens (and again if the person moves ~1 km)
  const where = userLocation ? `${userLocation.latitude.toFixed(2)},${userLocation.longitude.toFixed(2)}` : null;
  useEffect(() => {
    if (!userLocation) return;
    let alive = true;
    getNearestEvacuation(userLocation.latitude, userLocation.longitude)
      .then((r) => { if (alive) { setEvac(r); setEvacError(false); } })
      .catch(() => { if (alive) setEvacError(true); });
    return () => { alive = false; };
  }, [where]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasons = topSignals(risk, 2);
  const point = evac && evac.points && evac.points[0];
  const route = evac && evac.route && evac.route.success ? evac.route : null;
  const bg = drill ? '#4C1D95' : critical ? '#7F1D1D' : '#9A3412';

  return (
    <View style={[s.card, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLabel={`${drill ? 'Simulated drill. ' : ''}${level} flood risk where you are.`}>
      {drill ? <Text style={s.drill}>SIMULATED DRILL · NOT A REAL WARNING</Text> : null}
      <View style={s.head}>
        <Feather name="alert-octagon" size={22} color="#fff" />
        <Text style={s.title}>{level} FLOOD RISK WHERE YOU ARE</Text>
      </View>
      {risk.evidence_tier ? <Text style={s.tier}>{risk.evidence_tier}: {risk.evidence_tier_note}</Text> : null}

      <Text style={s.label}>WHERE</Text>
      <Text style={s.text}>{locationLabel || 'Your current location'}</Text>
      <Text style={s.label}>WHY</Text>
      <Text style={s.text}>{reasons.length ? reasons.map((r) => r.label).join(' · ') : risk.reason || 'See the evidence below.'}</Text>
      <Text style={s.label}>WHAT TO DO</Text>
      <Text style={[s.text, s.action]}>{risk.recommended_action || 'Avoid low-lying roads and follow official instructions.'}</Text>

      <View style={s.box}>
        <Text style={s.label}>NEAREST DESIGNATED EVACUATION POINT</Text>
        {point ? (
          <>
            <Text style={s.text}>{point.name} ({point.kind === 'HOSPITAL' ? 'hospital' : 'shelter / assembly point'}) · {point.distance_km} km</Text>
            {route ? <Text style={s.small}>Lower-risk route: {route.distance_km} km, about {route.eta_minutes} min{route.risk_information && route.risk_information.mean_risk_score != null ? ` · mean flood risk along it ${route.risk_information.mean_risk_score}/100` : ''}</Text> : null}
            <Text style={s.small}>Designated means listed in the source data, not verified safe or open.</Text>
          </>
        ) : evacError ? <Text style={s.small}>Could not look up evacuation points. Check your connection.</Text>
          : evac ? <Text style={s.small}>{evac.message || 'No designated evacuation point was found for this area.'}</Text>
            : <Text style={s.small}>Looking up the nearest designated point…</Text>}
        <View style={s.row}>
          <Pressable style={s.btn} onPress={() => navigate && navigate('Map', { focusEvacuation: true })} accessibilityRole="button">
            <Feather name="navigation" size={15} color={bg} />
            <Text style={[s.btnText, { color: bg }]}>Show lower-risk route</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnGhost]} onPress={() => navigate && navigate('Help')} accessibilityRole="button">
            <Feather name="life-buoy" size={15} color="#fff" />
            <Text style={[s.btnText, { color: '#fff' }]}>Request help</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.calls}>
        {CALLS.map(([n, label]) => (
          <Pressable key={n} style={s.call} onPress={() => Linking.openURL(`tel:${n}`).catch(() => {})} accessibilityRole="button" accessibilityLabel={`Call ${label}, ${n}`}>
            <Feather name="phone" size={14} color="#fff" />
            <Text style={s.callNum}>{n}</Text>
            <Text style={s.callLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, marginBottom: 14 },
  drill: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 0.6, backgroundColor: 'rgba(0,0,0,0.3)', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 20, flex: 1, lineHeight: 25 },
  tier: { color: 'rgba(255,255,255,0.88)', fontFamily: fonts.semibold, fontSize: 13, marginTop: 8, lineHeight: 19 },
  label: { color: 'rgba(255,255,255,0.75)', fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.8, marginTop: 12 },
  text: { color: '#fff', fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, marginTop: 2 },
  action: { fontFamily: fonts.extrabold },
  box: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 14, padding: 12, marginTop: 14 },
  small: { color: 'rgba(255,255,255,0.88)', fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, minHeight: 46, flexGrow: 1, justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#fff' },
  btnText: { fontFamily: fonts.extrabold, fontSize: 14 },
  calls: { flexDirection: 'row', gap: 8, marginTop: 12 },
  call: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, paddingVertical: 10, minHeight: 64 },
  callNum: { color: '#fff', fontFamily: fonts.extrabold, fontSize: 18, marginTop: 2 },
  callLabel: { color: 'rgba(255,255,255,0.8)', fontFamily: fonts.semibold, fontSize: 11 },
});
