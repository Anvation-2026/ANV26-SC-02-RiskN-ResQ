import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import MatchCard from '../components/MatchCard';
import { Chip } from './ReportScreen';
import { requestHelp } from '../services/api';
import { colors, radius, shadow } from '../theme';
import { USER } from '../services/geo';

const HELP = [
  ['MEDICINE', 'Medicine'], ['FOOD', 'Food'], ['WATER', 'Water'], ['FIRST_AID', 'First Aid'], ['EVACUATION', 'Evacuation Assistance'],
];
const PRIORITY = [['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High'], ['CRITICAL', 'Critical']];

export default function HelpScreen() {
  const [type, setType] = useState('MEDICINE');
  const [priority, setPriority] = useState('HIGH');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true);
    try {
      setResult(await requestHelp({ type, priority }));
    } catch (e) {
      setResult({ requestId: null, match: null });
    }
    setBusy(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="Request Community Help" subtitle="We'll look for a nearby volunteer" />
      <ScrollView contentContainerStyle={styles.body}>
        {result ? (
          <>
            {result.match ? (
              <MatchCard match={result.match} requestId={result.requestId} />
            ) : (
              <View style={styles.none}>
                <Text style={styles.noneTitle}>Request received{result.requestId ? ` · #${result.requestId}` : ''}</Text>
                <Text style={styles.noneBody}>No volunteer is available right now. Your request stays open and will be matched as soon as someone is free.</Text>
              </View>
            )}
            <View style={{ marginTop: 16 }}><ActionButton variant="primary" label="NEW REQUEST" color={colors.navy} onPress={() => setResult(null)} /></View>
          </>
        ) : (
          <>
            <Text style={styles.label}>HELP TYPE</Text>
            <View style={styles.wrap}>{HELP.map(([k, l]) => <Chip key={k} active={type === k} onPress={() => setType(k)}>{l}</Chip>)}</View>
            <Text style={styles.label}>PRIORITY</Text>
            <View style={styles.wrap}>{PRIORITY.map(([k, l]) => <Chip key={k} active={priority === k} onPress={() => setPriority(k)}>{l}</Chip>)}</View>
            <Text style={styles.label}>LOCATION</Text>
            <View style={styles.loc}><Text style={styles.locText}>📍 Current Location · {USER.label}</Text></View>
            <View style={{ marginTop: 24 }}>
              <ActionButton variant="primary" label={busy ? 'FINDING A VOLUNTEER…' : 'REQUEST HELP'} disabled={busy} color={colors.HIGH} onPress={submit} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 12, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 1.2, color: colors.muted, marginTop: 18, marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  loc: { backgroundColor: colors.card, borderRadius: radius.button, padding: 15, borderWidth: 1, borderColor: colors.border },
  locText: { fontSize: 15, fontFamily: 'PlusJakartaSans_600SemiBold', color: colors.text },
  none: { backgroundColor: colors.card, borderRadius: radius.card, padding: 20, ...shadow },
  noneTitle: { fontSize: 19, fontFamily: 'PlusJakartaSans_800ExtraBold', color: colors.text, marginBottom: 6 },
  noneBody: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 15, lineHeight: 22, color: colors.muted },
});
