import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ErrorText, Pill, SmallButton, statusColor } from '../../components/ui';
import { errorText } from '../../context/AuthContext';
import usePolling from '../../hooks/usePolling';
import { fetchIncidentPhoto, getAllIncidents, setIncident, deleteIncident } from '../../services/accountApi';
import { timeAgo } from '../../services/geo';
import { colors, fonts } from '../../theme';

export default function AdminIncidents() {
  const { data, error, reload } = usePolling(getAllIncidents, 6000);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
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
        {data && data.length === 0 && <Text style={styles.line}>No incidents yet.</Text>}
        {(data || []).map((i) => (
          <Card key={i.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{i.type.replace('_', ' ')} · #{i.id}</Text>
              <Pill text={i.status} color={statusColor(i.status)} />
            </View>
            <Text style={styles.desc}>{i.description || 'No description'}</Text>
            <Text style={styles.line}>{i.zone} · trust {i.trust_score} · severity {i.severity} · {timeAgo(i.timestamp)}</Text>
            {i.has_photo && (photos[i.id] && photos[i.id] !== 'loading' && photos[i.id] !== 'error' ? (
              <Image source={{ uri: photos[i.id] }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                <SmallButton label={photos[i.id] === 'loading' ? 'Loading photo…' : photos[i.id] === 'error' ? 'Photo unavailable · retry' : 'View photo'} outline disabled={photos[i.id] === 'loading'} onPress={() => showPhoto(i.id)} />
              </View>
            ))}
            <View style={styles.actions}>
              {i.status === 'REPORTED' && <SmallButton label="Verify" color={colors.LOW} disabled={busy} onPress={() => act(i.id, 'verify')} />}
              {i.status === 'REPORTED' && <SmallButton label="Reject" color={colors.HIGH} disabled={busy} onPress={() => act(i.id, 'reject')} />}
              {(i.status === 'REPORTED' || i.status === 'VERIFIED') && <SmallButton label="Resolve" outline disabled={busy} onPress={() => act(i.id, 'resolve')} />}
              <SmallButton label="Delete" color="#DC2626" disabled={busy} onPress={() => remove(i.id)} />
            </View>
          </Card>
        ))}
      </ScrollView>
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
