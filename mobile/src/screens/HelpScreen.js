import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import MatchCard from '../components/MatchCard';
import { Chip } from './ReportScreen';
import { requestHelp } from '../services/api';
import { errorText } from '../context/AuthContext';
import { ErrorText } from '../components/ui';
import { colors, radius, shadow } from '../theme';
import { USER } from '../services/geo';

const HELP = [
  ['MEDICINE', 'Medicine'],
  ['FOOD', 'Food'],
  ['WATER', 'Water'],
  ['FIRST_AID', 'First Aid'],
  ['EVACUATION', 'Evacuation'],
];

const PRIORITY = [
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
  ['CRITICAL', 'Critical'],
];

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState('MEDICINE');
  const [priority, setPriority] = useState('HIGH');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await requestHelp({ type, priority }));
    } catch (e) {
      setError(errorText(e)); // a rejected request is shown as an error, never as "queued"
    }
    setBusy(false);
  };

  return (
    <View style={styles.root}>
      <Header
        title="Request Help"
        subtitle="Automated Community Volunteer & Supply Dispatch"
      />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, 16) + 85 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {result ? (
          <>
            {result.match ? (
              <MatchCard match={result.match} requestId={result.requestId} />
            ) : (
              <View style={styles.none}>
                <Feather name="info" size={24} color="#D97706" style={{ marginBottom: 6 }} />
                <Text style={styles.noneTitle}>
                  Request Queued{result.requestId ? ` · #${result.requestId}` : ''}
                </Text>
                <Text style={styles.noneBody}>
                  No active volunteer currently matches this resource in your immediate radius. Your request remains open and will trigger dispatch once supplies become available.
                </Text>
              </View>
            )}
            <View style={{ marginTop: 14 }}>
              <ActionButton
                variant="primary"
                label="NEW REQUEST"
                color={colors.navy}
                onPress={() => setResult(null)}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>RESOURCE NEEDED</Text>
            <View style={styles.wrap}>
              {HELP.map(([k, l]) => (
                <Chip key={k} active={type === k} onPress={() => setType(k)}>
                  {l}
                </Chip>
              ))}
            </View>

            <Text style={styles.label}>TRIAGE PRIORITY</Text>
            <View style={styles.wrap}>
              {PRIORITY.map(([k, l]) => (
                <Chip key={k} active={priority === k} onPress={() => setPriority(k)}>
                  {l}
                </Chip>
              ))}
            </View>

            <Text style={styles.label}>DISPATCH LOCATION</Text>
            <View style={styles.loc}>
              <Feather name="map-pin" size={15} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.locText}>
                Current Position: {USER.label} ({USER.latitude}, {USER.longitude})
              </Text>
            </View>

            <View style={{ marginTop: 20 }}>
              <ErrorText>{error}</ErrorText>
              <ActionButton
                variant="primary"
                label={busy ? 'MATCHING COMMUNITY RESPONDERS...' : 'REQUEST ASSISTANCE'}
                disabled={busy}
                color={colors.HIGH}
                onPress={submit}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    padding: 14,
  },
  label: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.8,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 6,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  loc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  locText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    color: colors.text,
  },
  none: {
    backgroundColor: '#FFFBEB',
    borderRadius: radius.card,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 10,
    ...shadow,
  },
  noneTitle: {
    fontSize: 16,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#92400E',
    marginBottom: 4,
  },
  noneBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: '#78350F',
    textAlign: 'center',
    lineHeight: 18,
  },
});
