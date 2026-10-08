import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Label } from './ui';
import { ago, RAIN_COLOR, rainLabel } from './rain';
import { useT } from '../i18n';
import { haversineKm } from '../services/geo';
import { colors, fonts } from '../theme';

// Weather only: rainfall readings from the backend's cached grid. It never says "flood" (risk and reports are separate).
function nearest(monitor, at) {
  const list = (monitor && monitor.locations) || [];
  if (!at || !list.length) return null;
  return list.reduce((best, l) => {
    const d = haversineKm(at.latitude, at.longitude, l.latitude, l.longitude);
    return !best || d < best.d ? { l, d } : best;
  }, null);
}

export default function WeatherCard({ monitor, at, admin = false }) {
  const t = useT();
  if (!monitor) return <Card><Label>{admin ? 'WEATHER MONITOR' : t('weather.current')}</Label><Text style={s.dim}>{t('weather.unavailable')}</Text></Card>;
  const { summary = {}, status, updated_at: updated, source, message } = monitor;
  const stale = status !== 'ok';
  const near = nearest(monitor, at);
  const here = near && near.d <= 15 ? near.l : null; // a cell far from the user says nothing about the user's weather
  const level = here ? here.rain_level : null;

  if (admin) {
    return (
      <Card>
        <Label>WEATHER MONITOR</Label>
        <Text style={s.row}>Monitored locations: <Text style={s.bold}>{summary.monitored_locations ?? 0}</Text></Text>
        <Text style={s.row}>Heavy rain areas: <Text style={s.bold}>{summary.heavy_rain_locations ?? 0}</Text></Text>
        <Text style={s.row}>Highest rainfall: <Text style={s.bold}>{(summary.highest_rainfall_mm ?? 0).toFixed(1)} mm/h</Text></Text>
        <Text style={s.row}>Last updated: <Text style={s.bold}>{updated ? ago(updated) : 'never'}</Text></Text>
        <Text style={s.row}>Source: <Text style={s.bold}>{source || 'unavailable'}</Text></Text>
        {stale && <Text style={s.stale}>{message || 'Weather data unavailable'}</Text>}
      </Card>
    );
  }
  return (
    <Card>
      <Label>{t('weather.current')}</Label>
      {!here ? (
        <Text style={s.dim}>{stale ? (message || t('weather.unavailable')) : t('weather.outside')}</Text>
      ) : (
        <>
          <Text style={[s.big, { color: RAIN_COLOR[level] === '#64748B' ? colors.text : RAIN_COLOR[level] }]}>
            {level === 'HEAVY' || level === 'VERY_HEAVY' ? '🌧️ ' : ''}{rainLabel(t, level)}
          </Text>
          <Text style={s.row}>{here.rainfall_mm.toFixed(1)} mm/h now · {(here.rainfall_24h_mm ?? 0).toFixed(1)} mm in 24 h</Text>
          <Text style={s.meta}>
            {t('weather.updated')} {ago(updated)} · {t('weather.source')}: {source}
            {summary.heavy_rain_locations > 0 ? ` · Heavy rain in ${summary.heavy_rain_locations} monitored area(s)` : ''}
          </Text>
          {here.forecast_level && (here.forecast_level === 'HEAVY' || here.forecast_level === 'VERY_HEAVY') && level !== 'HEAVY' && level !== 'VERY_HEAVY' ? (
            <Text style={s.forecast}>🌧️ {t('weather.expected', { h: here.forecast_peak_in_h })} ({here.forecast_peak_mm.toFixed(1)} mm/h)</Text>
          ) : null}
          {stale && <Text style={s.stale}>{message || t('weather.unavailable')}</Text>}
        </>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  big: { fontFamily: fonts.extrabold, fontSize: 20, marginTop: 4 },
  row: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, marginTop: 4 },
  bold: { fontFamily: fonts.bold },
  meta: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, marginTop: 6 },
  dim: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: 4 },
  forecast: { fontFamily: fonts.bold, fontSize: 13, color: '#C2410C', marginTop: 8 },
  stale: { fontFamily: fonts.bold, fontSize: 12, color: '#B45309', marginTop: 6 },
});
