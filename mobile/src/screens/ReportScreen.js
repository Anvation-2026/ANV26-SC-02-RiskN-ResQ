import React, { useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import Header from '../components/Header';
import ActionButton from '../components/ActionButton';
import { useData } from '../context/DataContext';
import { AnimatedBar, FadeIn, PopIn } from '../components/motion';
import * as ImagePicker from 'expo-image-picker';
import { newRequestKey, submitIncident, uploadIncidentPhoto } from '../services/api';
import { colors, radius, shadow } from '../theme';

const TYPES = [
  { key: 'FLOODED_ROAD', label: 'Flood Hazard', icon: 'droplet' },
  { key: 'BLOCKED_ROAD', label: 'Blocked Road', icon: 'alert-triangle' },
  { key: 'WATERLOGGING', label: 'Waterlogging', icon: 'cloud-rain' },
  { key: 'FALLEN_TREE', label: 'Tree / Debris', icon: 'slash' },
];

export const Chip = ({ active, onPress, children }) => (
  <Pressable
    onPress={onPress}
    style={[styles.chip, active && styles.chipOn]}
    hitSlop={4}
  >
    <Text style={[styles.chipText, active && styles.chipTextOn]}>{children}</Text>
  </Pressable>
);

export default function ReportScreen({ navigate }) {
  const insets = useSafeAreaInsets();
  const { userLocation, locationLabel, requestPermission, refresh } = useData();
  const [type, setType] = useState('FLOODED_ROAD');
  const [text, setText] = useState('');
  const [severity, setSeverity] = useState(3);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(null); // 0-100 while the photo is uploading
  const formKey = useRef(newRequestKey()); // one key per form: a double tap or retry never files the report twice
  const [submitted, setSubmitted] = useState(null); // the server's answer, including how the environment compares with the report
  const [errorMsg, setErrorMsg] = useState(null);
  const [photo, setPhoto] = useState(null); // asset chosen with the picker
  const [photoResult, setPhotoResult] = useState(null); // {status: 'uploaded'|'failed', message?}

  const pickPhoto = async (useCamera) => {
    setErrorMsg(null);
    try {
      const perm = useCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErrorMsg(useCamera ? 'Camera permission was denied.' : 'Photo library permission was denied.');
        return;
      }
      const res = useCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5 });
      if (!res.canceled && res.assets && res.assets[0]) setPhoto(res.assets[0]);
    } catch (e) {
      setErrorMsg('Could not open the photo picker on this device.');
    }
  };

  const submit = async () => {
    if (!userLocation) {
      setErrorMsg('Location access is required to submit a verified hazard report.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const incident = await submitIncident({
        type,
        description: text.trim() || `${type.replace('_', ' ')} verified on site`,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        severity,
        idempotencyKey: formKey.current,
      });
      setSubmitted(incident);
      let result = null;
      if (photo) {
        try {
          setProgress(0);
          const stored = await uploadIncidentPhoto(incident.id, photo.uri, setProgress); // resolves only after the server stored it
          result = { status: 'uploaded', storage: stored && stored.storage };
        } catch (e) {
          result = { status: 'failed', message: (e && e.detail) || 'Please try again later.' };
        }
      }
      setPhotoResult(result);
      await refresh();
      setDone(true);
    } catch (e) {
      setErrorMsg(e && e.status ? (e.detail || 'The server rejected the report.') : 'Could not reach the server. Your report was not sent. Check your connection and try again.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const reset = () => {
    formKey.current = newRequestKey();
    setDone(false);
    setSubmitted(null);
    setText('');
    setType('FLOODED_ROAD');
    setSeverity(3);
    setErrorMsg(null);
    setPhoto(null);
    setPhotoResult(null);
  };

  return (
    <View style={styles.root}>
      <Header
        title="Report Incident"
        subtitle="Submit Hyper-Local Hazard Telemetry"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: Math.max(insets.bottom, 16) + 85 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {done ? (
            <View style={styles.success}>
              <PopIn><View style={styles.check}>
                <Feather name="check" size={24} color="#FFFFFF" />
              </View></PopIn>
              <Text style={styles.sTitle}>Incident Broadcast</Text>
              <Text style={styles.sBody}>
                Your report has been logged. It is compared with weather, satellite and terrain data and supports the flood-risk estimate; one report on its own does not declare a flood.
              </Text>
              {submitted && submitted.merged_into ? <Text style={styles.photoOk}>Similar nearby reports were merged, which raises confidence in this one.</Text> : null}
              {submitted && submitted.environmental_context ? (
                <View style={{ alignSelf: 'stretch', marginTop: 10 }}>
                  <Text style={styles.sBody}>Incident confidence: {String(submitted.confidence || '').toLowerCase()}. Environment at this spot:</Text>
                  {submitted.environmental_context.map((line) => <Text key={line} style={styles.sBody}>• {line}</Text>)}
                </View>
              ) : null}
              {photoResult && photoResult.status === 'uploaded' ? <Text style={styles.photoOk}>Photo uploaded with your report.</Text> : null}
              {photoResult && photoResult.status === 'uploaded' ? <Text style={styles.sBody}>{photoResult.storage === 'cloudinary' ? 'Stored in cloud storage.' : 'Stored on the RiskN ResQ server (cloud storage is not configured).'}</Text> : null}
              {photoResult && photoResult.status === 'failed' ? <Text style={styles.photoBad}>Your report was saved, but the photo could not be uploaded: {photoResult.message}</Text> : null}
              <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 16 }}>
                <ActionButton
                  variant="primary"
                  label="VIEW LIVE MAP"
                  onPress={() => navigate('Map')}
                />
                <ActionButton
                  variant="primary"
                  label="SUBMIT ANOTHER"
                  color={colors.navy}
                  onPress={reset}
                />
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.label}>INCIDENT CLASSIFICATION</Text>
              <View style={styles.types}>
                {TYPES.map((t) => {
                  const active = type === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setType(t.key)}
                      style={[styles.typeBtn, active && styles.typeBtnOn]}
                    >
                      <Feather
                        name={t.icon}
                        size={18}
                        color={active ? colors.primary : '#64748B'}
                      />
                      <Text style={[styles.typeText, active && styles.typeTextOn]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>GEO-COORDINATES</Text>
              <Pressable
                onPress={!userLocation ? requestPermission : undefined}
                style={[styles.field, userLocation && styles.fieldOk]}
              >
                <Feather
                  name="crosshair"
                  size={16}
                  color={userLocation ? colors.LOW : colors.HIGH}
                />
                <Text style={styles.fieldText}>
                  {userLocation
                    ? `Locked: ${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)} (${locationLabel})`
                    : 'Tap to grant location permission'}
                </Text>
              </Pressable>

              <Text style={styles.label}>SEVERITY LEVEL (1-5)</Text>
              <View style={styles.severityRow}>
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <Pressable
                    key={lvl}
                    onPress={() => setSeverity(lvl)}
                    style={[styles.sevBtn, severity === lvl && styles.sevBtnActive]}
                  >
                    <Text style={[styles.sevText, severity === lvl && styles.sevTextActive]}>
                      {lvl}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>FIELD OBSERVATION</Text>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Describe water depth, obstruction, or damage..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
              />

              <Text style={styles.label}>PHOTO (OPTIONAL)</Text>
              {photo ? (
                <FadeIn from="none" duration={300}>
                  <View style={styles.photoBox}>
                    <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
                    <View style={{ position: 'absolute', right: 8, top: 8, flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => pickPhoto(Platform.OS !== 'web')} style={styles.photoRemove} hitSlop={8} disabled={busy} accessibilityRole="button">
                        <Feather name={Platform.OS === 'web' ? 'image' : 'camera'} size={14} color="#fff" />
                        <Text style={styles.photoRemoveText}>{Platform.OS === 'web' ? 'Change' : 'Retake'}</Text>
                      </Pressable>
                      <Pressable onPress={() => setPhoto(null)} style={styles.photoRemove} hitSlop={8} disabled={busy} accessibilityRole="button">
                        <Feather name="x" size={14} color="#fff" />
                        <Text style={styles.photoRemoveText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                </FadeIn>
              ) : (
                <View style={styles.photoRow}>
                  <Pressable onPress={() => pickPhoto(false)} style={[styles.field, styles.photoBtn]}>
                    <Feather name="image" size={16} color={colors.primary} />
                    <Text style={styles.fieldText}>Choose photo</Text>
                  </Pressable>
                  {Platform.OS !== 'web' && (
                    <Pressable onPress={() => pickPhoto(true)} style={[styles.field, styles.photoBtn]}>
                      <Feather name="camera" size={16} color={colors.primary} />
                      <Text style={styles.fieldText}>Take photo</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {errorMsg && (
                <Text style={styles.errorText}>{errorMsg}</Text>
              )}

              {busy && photo && progress != null ? (
                <FadeIn from="none" duration={200}>
                  <View style={{ marginTop: 12 }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }}>
                    <AnimatedBar pct={progress} color={colors.primary} height={8} track="#E2E8F0" />
                    <Text style={styles.uploadText}>Uploading photo… {progress}%</Text>
                  </View>
                </FadeIn>
              ) : null}

              <View style={{ marginTop: 14 }}>
                <ActionButton
                  variant="primary"
                  label={busy ? 'TRANSMITTING REPORT...' : 'SUBMIT REPORT'}
                  loading={busy}
                  disabled={busy || !userLocation}
                  color={colors.HIGH}
                  onPress={submit}
                />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  uploadText: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12, color: colors.muted, marginTop: 6 },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { flex: 1, justifyContent: 'center' },
  photoBox: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#E2E8F0' },
  photoPreview: { width: '100%', height: 180 },
  photoRemove: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,23,42,0.8)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  photoRemoveText: { color: '#fff', fontSize: 12, fontFamily: 'PlusJakartaSans_700Bold' },
  photoOk: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: colors.LOW, marginTop: 10, textAlign: 'center' },
  photoBad: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, color: '#B45309', marginTop: 10, textAlign: 'center', lineHeight: 19 },
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
  types: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  typeBtnOn: {
    borderColor: colors.primary,
    backgroundColor: '#EFF6FF',
  },
  typeText: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: colors.muted,
    textAlign: 'center',
  },
  typeTextOn: {
    color: colors.primary,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 6,
    ...shadow,
  },
  fieldOk: {
    borderColor: colors.LOW,
    backgroundColor: '#F0FDF4',
  },
  fieldText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    color: colors.text,
  },
  severityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sevBtn: {
    flex: 1,
    backgroundColor: colors.card,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  sevBtnActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  sevText: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 14,
    color: colors.text,
  },
  sevTextActive: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: colors.text,
    minHeight: 75,
    textAlignVertical: 'top',
    marginBottom: 8,
    ...shadow,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
    color: colors.text,
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  success: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
    ...shadow,
  },
  check: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.LOW,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  sTitle: {
    fontSize: 18,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: colors.text,
    marginBottom: 4,
  },
  sBody: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: colors.HIGH,
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    marginBottom: 8,
  },
});
