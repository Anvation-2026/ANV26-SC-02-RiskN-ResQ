import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ago } from './rain';
import { fonts } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

// "Why this risk?": every signal the backend's flood-intelligence engine used, in plain words, with its value, source, time,
// freshness and how much it contributed. Signals with no data are listed as unavailable; nothing is estimated here.
// The wording is always "risk" / "observed" / "modelled", never "confirmed flood".
export const FAMILY = {
  rainfall: { title: 'RAIN', icon: 'cloud-rain' },
  forecast: { title: 'FORECAST', icon: 'cloud-drizzle' },
  satellite: { title: 'SATELLITE', icon: 'radio', note: 'A satellite pass shows water extent on one day. Water change observed is not a confirmed flood.' },
  terrain: { title: 'TERRAIN', icon: 'triangle', note: 'Terrain increases susceptibility; it does not by itself prove flooding.' },
  river: { title: 'RIVER (MODELLED)', icon: 'activity', note: 'Modelled river data, not a physical gauge measurement.' },
  history: { title: 'HISTORY', icon: 'clock' },
  reports: { title: 'COMMUNITY REPORTS', icon: 'users', note: 'Secondary evidence: reports alone cannot raise the risk to HIGH.' },
};

// how much one signal moved the score, from the backend's own points and maximum for that signal
export function impactOf(sig) {
  if (!sig || !sig.points) return { word: 'NONE', color: 'rgba(148,163,184,0.9)' };
  const share = sig.max_points ? sig.points / sig.max_points : 0;
  if (share >= 0.6) return { word: 'HIGH', color: '#F87171' };
  if (share >= 0.3) return { word: 'MEDIUM', color: '#FBBF24' };
  return { word: 'LOW', color: '#4ADE80' };
}

// the strongest contributing signals, for the short always-visible summary
export function topSignals(risk, n = 4) {
  const list = Array.isArray(risk && risk.signals) ? risk.signals : [];
  return list.filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, n);
}

export default function RiskExplainer({ risk, light = true, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  const signals = Array.isArray(risk && risk.signals) ? risk.signals : [];
  const missing = Array.isArray(risk && risk.missing) ? risk.missing : [];
  if (!signals.length && !missing.length) return null;
  const fg = light ? '#FFFFFF' : '#0F172A';
  const soft = light ? 'rgba(255,255,255,0.78)' : '#475569';
  const rowBg = light ? 'rgba(0,0,0,0.22)' : '#F1F5F9';
  const toggle = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); };
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8} style={s.toggleRow}>
        <Feather name="info" size={13} color={fg} />
        <Text style={[s.toggle, { color: fg }]}>{open ? 'Hide the evidence' : 'Why this risk? See every signal'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={fg} />
      </Pressable>
      {open && (
        <View style={{ marginTop: 8 }}>
          {signals.map((x) => {
            const fam = FAMILY[x.key] || { title: String(x.key || '').toUpperCase(), icon: 'circle' };
            const imp = impactOf(x);
            return (
              <View key={x.key} style={[s.row, { backgroundColor: rowBg }]} accessible accessibilityLabel={`${fam.title}: ${x.label}. ${x.detail}. Impact ${imp.word}.`}>
                <View style={s.rowTop}>
                  <Feather name={fam.icon} size={13} color={fg} />
                  <Text style={[s.fam, { color: fg }]}>{fam.title}</Text>
                  <View style={[s.impact, { borderColor: imp.color }]}><Text style={[s.impactText, { color: imp.color }]}>IMPACT {imp.word}</Text></View>
                </View>
                <Text style={[s.label, { color: fg }]}>{x.label}</Text>
                <Text style={[s.detail, { color: soft }]}>{x.detail}</Text>
                <Text style={[s.meta, { color: soft }]}>
                  Source: {x.source || 'not stated'}
                  {x.observed_at ? ` · ${x.key === 'satellite' ? 'observation' : 'updated'} ${ago(x.observed_at)}` : ''}
                  {x.stale ? ' · STALE DATA' : x.observed_at ? ' · current' : ''}
                  {x.max_points ? ` · contributed ${x.points} of up to ${x.max_points} points` : ''}
                </Text>
                {fam.note ? <Text style={[s.note, { color: soft }]}>{fam.note}</Text> : null}
              </View>
            );
          })}
          {missing.length > 0 && (
            <View style={[s.row, { backgroundColor: rowBg }]}>
              <View style={s.rowTop}>
                <Feather name="slash" size={13} color={fg} />
                <Text style={[s.fam, { color: fg }]}>MISSING SIGNALS</Text>
              </View>
              {missing.map((m) => (
                <Text key={m.key} style={[s.detail, { color: soft }]}>• {(FAMILY[m.key] || {}).title || m.label}: {m.reason}</Text>
              ))}
              <Text style={[s.note, { color: soft }]}>Missing signals do not contribute. Nothing is estimated in their place.</Text>
            </View>
          )}
          <Text style={[s.foot, { color: soft }]}>
            {risk.model || 'Prototype flood-risk model'}
            {risk.probability != null ? `. Probability ${Math.round(risk.probability * 100)}%: ${risk.probability_basis || risk.probabilityBasis || 'prototype estimate, uncalibrated'}.` : '.'}
            {risk.confidence_basis ? ` Data confidence: ${risk.confidence_basis}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  toggle: { fontFamily: fonts.bold, fontSize: 12 },
  row: { borderRadius: 12, padding: 11, marginBottom: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fam: { fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.7, flex: 1 },
  impact: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  impactText: { fontFamily: fonts.extrabold, fontSize: 9, letterSpacing: 0.5 },
  label: { fontFamily: fonts.bold, fontSize: 13, marginTop: 6 },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meta: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 16, marginTop: 4 },
  note: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15, marginTop: 4, fontStyle: 'italic' },
  foot: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 4 },
});
