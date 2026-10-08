import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ConfirmDialog, ErrorText, Pill, SmallButton, StateView, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { fetchIncidentPhoto, getAllIncidents, setIncident, deleteIncident } from '../../services/accountApi';
import { timeAgo } from '../../services/geo';
import { colors, fonts } from '../../theme';

export default function AdminIncidents() {
  const { data, error, reload } = usePolling(getAllIncidents, 6000);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [photos, setPhotos] = useState({}); // incident id -> data URI | 'loading' | 'error'

  const showPhoto = async (id) => {
    setPhotos((p) => ({ ...p, [id]: 'loading' }));
    try { const uri = await fetchIncidentPhoto(id); setPhotos((p) => ({ ...p, [id]: uri })); } catch (e) { setPhotos((p) => ({ ...p, [id]: 'error' })); }
  };

  const act = async (id, action) => {
    setBusy(true);
    setActionError('');
    try { await setIncident(id, action); await reload(); } catch (e) { setActionError(errorText(e)); }
    setBusy(false);
  };

  const remove = async (id) => {
    setBusy(true);
    setActionError('');
    try { await deleteIncident(id); await reload(); } catch (e) { setActionError(errorText(e)); }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Incidents" subtitle="Verify, reject or resolve citizen reports" />
      <ScrollView contentContainerStyle={styles.body}>
        <ErrorText>{actionError || error}</ErrorText>
        {!data && !error ? <StateView kind="loading" /> : null}
        {!data && error ? <StateView kind="error" title="Unable to load incident reports." message={error} onRetry={reload} /> : null}
        {data && data.length === 0 && <StateView kind="empty" icon="shield" title="No incident reports yet." message="Community reports appear here for review." />}
        {(data || []).map((i) => (
          <Card key={i.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{i.type.replace('_', ' ')} · #{i.id}</Text>
              <Pill text={i.status} color={statusColor(i.status)} />
            </View>
            <Text style={styles.desc}>{i.description || 'No description'}</Text>
            <Text style={styles.line}>{i.zone} · trust {i.trust_score} · severity {i.severity} · {timeAgo(i.timestamp)}</Text>
            {i.duplicate_of ? <Text style={styles.line}>Duplicate of #{i.duplicate_of} (merged into that report)</Text> : null}
            {i.confirmations ? <Text style={styles.line}>{i.confirmations} duplicate report(s) merged into this one</Text> : null}
            {Array.isArray(i.trust_factors) ? (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.line}>Confidence {String(i.confidence || '').toLowerCase()} ({i.trust_score}/100), because:</Text>
                {i.trust_factors.map((f) => <Text key={f.label} style={styles.line}>{f.points >= 0 ? '+' : ''}{f.points}  {f.label}</Text>)}
              </View>
            ) : null}
            {i.has_photo && (photos[i.id] && photos[i.id] !== 'loading' && photos[i.id] !== 'error' ? (
              <Image source={{ uri: photos[i.id] }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                <SmallButton label={photos[i.id] === 'loading' ? 'Loading photo…' : photos[i.id] === 'error' ? 'Photo unavailable · retry' : 'View photo'} outline disabled={photos[i.id] === 'loading'} onPress={() => showPhoto(i.id)} />
              </View>
            ))}
            <View style={styles.actions}>
              {i.status === 'REPORTED' && <SmallButton label="Verify" color={colors.LOW} disabled={busy} onPress={() => act(i.id, 'verify')} />}
              {i.status === 'REPORTED' && <SmallButton label="Reject" color={colors.HIGH} disabled={busy} onPress={() => setConfirm({ id: i.id, kind: i.type.replace('_', ' ').toLowerCase() })} />}
              {(i.status === 'REPORTED' || i.status === 'VERIFIED') && <SmallButton label="Resolve" outline disabled={busy} onPress={() => act(i.id, 'resolve')} />}
              <SmallButton label="Delete" color="#DC2626" disabled={busy} onPress={() => remove(i.id)} />
            </View>
          </Card>
        ))}
      </ScrollView>
      <ConfirmDialog visible={!!confirm} title="Reject this report?" message={confirm ? `This ${confirm.kind} report stops counting toward risk and trust. The reporter is not notified.` : ''} confirmLabel="Reject report" danger busy={busy}
        onCancel={() => setConfirm(null)} onConfirm={async () => { const id = confirm.id; setConfirm(null); await act(id, 'reject'); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 190, borderRadius: 12, marginTop: 10 },
  body: { padding: 16, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  desc: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, marginTop: 8 },
  line: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
