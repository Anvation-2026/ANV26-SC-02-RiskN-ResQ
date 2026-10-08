import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ago } from './rain';
import { fonts } from '../theme';

// "Why is the risk what it is": every contributing signal with its value, source and time; signals with no data are listed
// as unavailable (never estimated). Wording stays "flood risk is elevated because..." and never "AI says".
export default function RiskExplainer({ risk, light = true }) {
  const [open, setOpen] = useState(false);
  const signals = Array.isArray(risk.signals) ? risk.signals : [];
  const missing = Array.isArray(risk.missing) ? risk.missing : [];
  if (!signals.length && !missing.length) return null;
  const fg = light ? '#FFFFFF' : '#0F172A';
  const soft = light ? 'rgba(255,255,255,0.8)' : '#475569';
  return (
    <View style={{ marginTop: 10 }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8}>
        <Text style={[s.toggle, { color: fg }]}>{open ? 'Hide why ▲' : 'Why this risk? ▼'}</Text>
      </Pressable>
      {open && (
        <View style={[s.box, { backgroundColor: light ? 'rgba(0,0,0,0.22)' : '#F1F5F9' }]}>
          {signals.map((x) => (
            <View key={x.key} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.label, { color: fg }]}>
                  {x.label}{x.points ? `  +${x.points}` : ''}{x.stale ? '  (STALE DATA)' : ''}
                </Text>
                <Text style={[s.detail, { color: soft }]}>{x.detail}</Text>
                <Text style={[s.src, { color: soft }]}>
                  {x.source || 'source n/a'}{x.observed_at ? ` · ${ago(x.observed_at)}` : ''}
                </Text>
              </View>
            </View>
          ))}
          {missing.length > 0 && (
            <Text style={[s.detail, { color: soft, marginTop: 6 }]}>
              Not available: {missing.map((m) => `${m.label.toLowerCase()} (${m.reason.toLowerCase().replace(/\.$/, '')})`).join('; ')}
            </Text>
          )}
          <Text style={[s.foot, { color: soft }]}>
            {risk.model || 'Prototype flood-risk model'}
            {risk.probability != null ? `. Probability ${Math.round(risk.probability * 100)}%: ${risk.probabilityBasis || 'prototype estimate, uncalibrated'}.` : '.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  toggle: { fontFamily: fonts.bold, fontSize: 12 },
  box: { borderRadius: 12, padding: 12, marginTop: 8 },
  row: { flexDirection: 'row', marginBottom: 8 },
  label: { fontFamily: fonts.bold, fontSize: 13 },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 1 },
  src: { fontFamily: fonts.medium, fontSize: 11, marginTop: 2 },
  foot: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, marginTop: 6 },
});
