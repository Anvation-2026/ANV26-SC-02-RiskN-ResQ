import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import MatchCard from '../components/MatchCard';
import MyHelpRequests from '../components/MyHelpRequests';
import { Chip } from './ReportScreen';
import { useData } from '../context/DataContext';
import { useResponse } from '../context/ResponseContext';
import { colors, radius, shadow } from '../theme';

const HELP = [
  ['MEDICAL_EMERGENCY', 'Medical Emergency'],
  ['FLOOD_RESCUE', 'Flood Rescue'],
  ['EVACUATION', 'Evacuation'],
  ['ELDERLY_ASSISTANCE', 'Elderly Assistance'],
  ['CHILD_ASSISTANCE', 'Child Assistance'],
  ['FOOD_WATER', 'Food / Water'],
  ['TRANSPORT', 'Transport'],
  ['FIRST_AID', 'First Aid'],
  ['OTHER_EMERGENCY', 'Other Emergency'],
];

const PRIORITY = [
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
  ['CRITICAL', 'Critical'],
];

export default function HelpScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { userLocation, locationLabel, requestPermission } = useData();
  const { requestResource } = useResponse();

  const [type, setType] = useState('MEDICAL_EMERGENCY');
  const [priority, setPriority] = useState('HIGH');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const submit = async () => {
    if (!userLocation) {
      setErrorMsg('Device location is required to dispatch emergency resources.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const matchRes = await requestResource({
        type,
        priority,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (matchRes && matchRes.failed) setErrorMsg(matchRes.message); // a failed request is an error, never a "queued" request
      else setResult(matchRes);
    } catch (e) {
      setErrorMsg('Could not send your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const cardMatch = result && result.matched && result.volunteer ? {
    volunteer: result.volunteer.name,
    resource: result.volunteer.resource || result.volunteer.skill || type,
    distanceKm: result.distanceKm || 0,
    status: 'Available',
    score: result.matchScore || 85,
    breakdown: result.scoreBreakdown,
  } : null;

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
            {cardMatch ? (
              <>
                <MatchCard match={cardMatch} requestId={result.requestId} />
                <View style={{ marginTop: 12, gap: 10 }}>
                  <ActionButton
                    variant="primary"
                    label="TRACK RESPONDER IN REAL TIME"
                    color={colors.route}
                    onPress={() => navigate('Tracking', { requestId: result.requestId })}
                  />
                  <ActionButton
                    variant="primary"
                    label="NAVIGATE CORRIDOR ON LIVE MAP"
                    color={colors.primary}
                    onPress={() => navigate('Map')}
                  />
                  <ActionButton
                    variant="primary"
                    label="SUBMIT NEW REQUEST"
                    color={colors.navy}
                    onPress={() => setResult(null)}
                  />
                </View>
              </>
            ) : (
              <View style={styles.none}>
                <Feather name="info" size={24} color="#D97706" style={{ marginBottom: 6 }} />
                <Text style={styles.noneTitle}>No suitable nearby responder found yet.</Text>
                <Text style={styles.noneBody}>
                  Your request has been broadcasted and remains OPEN. You will be matched as soon as an available volunteer checks in.
                </Text>
                <View style={{ alignSelf: 'stretch', marginTop: 14, gap: 10 }}>
                  {result?.requestId && (
                    <ActionButton
                      variant="primary"
                      label="MONITOR DISPATCH STATUS"
                      color={colors.route}
                      onPress={() => navigate('Tracking', { requestId: result.requestId })}
                    />
                  )}
                  <ActionButton
                    variant="primary"
                    label="NEW REQUEST"
                    color={colors.navy}
                    onPress={() => setResult(null)}
                  />
                </View>
              </View>
            )}
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

            <Text style={styles.label}>CONTACT NUMBER (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. +91 98765 43210"
              placeholderTextColor="#94A3B8"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>SITUATION DETAILS / LANDMARK (OPTIONAL)</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Describe urgent needs, trapped persons, or accessibility hurdles..."
              placeholderTextColor="#94A3B8"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.label}>DISPATCH COORDINATES</Text>
            <Pressable
              onPress={!userLocation ? requestPermission : undefined}
              style={[styles.loc, userLocation && styles.locOk]}
            >
              <Feather
                name="map-pin"
                size={15}
                color={userLocation ? colors.primary : colors.HIGH}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.locText}>
                {userLocation
                  ? `Position: ${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)} (${locationLabel})`
                  : 'Tap to grant location permission'}
              </Text>
            </Pressable>

            {errorMsg && (
              <Text style={styles.errorText}>{errorMsg}</Text>
            )}

            <View style={{ marginTop: 20 }}>
              <ActionButton
                variant="primary"
                label={busy ? 'MATCHING COMMUNITY RESPONDERS...' : 'REQUEST ASSISTANCE'}
                disabled={busy || !userLocation}
                color={colors.HIGH}
                onPress={submit}
              />
            </View>
          </>
        )}
        <MyHelpRequests navigate={navigate} />
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
    fontSize: 11,
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
  locOk: {
    borderColor: '#CBD5E1',
  },
  locText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    color: colors.text,
    flex: 1,
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
  errorText: {
    color: colors.HIGH,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    marginTop: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: radius.button,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: colors.text,
    marginBottom: 6,
    ...shadow,
  },
  multilineInput: {
    minHeight: 65,
    textAlignVertical: 'top',
  },
});
