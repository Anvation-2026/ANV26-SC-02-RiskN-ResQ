import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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
import MapView from '../components/MapView';
import ActionButton from '../components/ActionButton';
import { Card, Pill, statusColor } from '../components/ui';
import { useData } from '../context/DataContext';
import { cancelHelpRequest, completeHelpRequest, getHelpRequestTracking } from '../services/api';
import { prettyResource } from '../integration/volunteerAdapter';
import { colors, fonts, radius, shadow } from '../theme';

const POLL_INTERVAL_MS = 5000;

const STATUS_DESCRIPTIONS = {
  OPEN: 'Your request has been broadcasted to verified community responders.',
  MATCHED: 'A responder has been assigned and notified of your location.',
  ACCEPTED: 'A volunteer has accepted your request and is preparing dispatch.',
  EN_ROUTE: 'The responder is currently in transit to your coordinates.',
  ARRIVED: 'The responder has arrived at your reported emergency location.',
  COMPLETED: 'This emergency assistance request was successfully resolved.',
  CANCELLED: 'This request was cancelled.',
};

export default function LiveAssistanceScreen({ navigate, params, onBack }) {
  const insets = useSafeAreaInsets();
  const { activeAssistance, refresh: refreshGlobalData } = useData();

  const requestId = params?.requestId || activeAssistance?.request_id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionMsg, setActionMsg] = useState(null);

  const aliveRef = useRef(true);

  const fetchTracking = useCallback(async () => {
    if (!requestId) return;
    try {
      const res = await getHelpRequestTracking(requestId);
      if (aliveRef.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (aliveRef.current) {
        setError(err?.detail || err?.message || 'Unable to update tracking status.');
      }
    } finally {
      if (aliveRef.current) {
        setLoading(false);
      }
    }
  }, [requestId]);

  useEffect(() => {
    aliveRef.current = true;
    fetchTracking();
    const interval = setInterval(fetchTracking, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(interval);
    };
  }, [fetchTracking]);

  const handleCall = (phone) => {
    if (!phone) {
      Alert.alert('No Phone Number', 'The responder did not provide a contact number.');
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert('Error', 'Unable to initiate phone call on this device.');
    });
  };

  const handleCancel = async () => {
    if (!requestId) return;
    setCancelling(true);
    setActionMsg(null);
    try {
      await cancelHelpRequest(requestId, cancelReason.trim());
      setCancelModalVisible(false);
      setCancelReason('');
      await fetchTracking();
      refreshGlobalData();
      Alert.alert('Request Cancelled', 'Your help request has been cancelled.');
    } catch (err) {
      setActionMsg(err?.detail || err?.message || 'Failed to cancel request.');
    } finally {
      setCancelling(false);
    }
  };

  const handleComplete = async () => {
    if (!requestId) return;
    setCancelling(true);
    setActionMsg(null);
    try {
      await completeHelpRequest(requestId);
      await fetchTracking();
      refreshGlobalData();
      Alert.alert('Assistance Completed', 'Thank you! The request has been marked complete.');
    } catch (err) {
      setActionMsg(err?.detail || err?.message || 'Failed to complete request.');
    } finally {
      setCancelling(false);
    }
  };

  const goBack = () => {
    if (onBack) onBack();
    else if (navigate) navigate('Home');
  };

  // Map markers and route line
  const { markers, routeCoords, userCoord } = useMemo(() => {
    const list = [];
    let userPt = null;

    if (data?.requester?.latitude != null && data?.requester?.longitude != null) {
      userPt = { latitude: data.requester.latitude, longitude: data.requester.longitude };
      list.push({
        id: 'requester',
        latitude: data.requester.latitude,
        longitude: data.requester.longitude,
        label: 'YOU (Requester)',
        color: colors.primary,
        highlight: true,
      });
    }

    if (data?.volunteer?.latitude != null && data?.volunteer?.longitude != null) {
      list.push({
        id: 'volunteer',
        latitude: data.volunteer.latitude,
        longitude: data.volunteer.longitude,
        label: `★ ${data.volunteer.name || 'Responder'}`,
        color: colors.route,
        highlight: true,
      });
    }

    if (data?.requester?.destination_lat != null && data?.requester?.destination_lng != null) {
      list.push({
        id: 'dest',
        latitude: data.requester.destination_lat,
        longitude: data.requester.destination_lng,
        label: 'Target Destination',
        color: '#D97706',
        highlight: false,
      });
    }

    const poly = Array.isArray(data?.route_polyline) ? data.route_polyline : null;

    return { markers: list, routeCoords: poly, userCoord: userPt };
  }, [data]);

  const reqStatus = data?.status || activeAssistance?.status || 'PENDING';
  const isFinished = reqStatus === 'COMPLETED' || reqStatus === 'CANCELLED';
  const volunteer = data?.volunteer;

  return (
    <View style={styles.root}>
      <Header
        title="Live Assistance"
        subtitle={data ? `${prettyResource(data.type)} · #${data.request_id}` : 'Responder Tracking'}
        left={
          <Pressable onPress={goBack} hitSlop={8} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#FFFFFF" />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          { paddingBottom: Math.max(insets.bottom, 16) + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading && !data ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Connecting to emergency dispatch...</Text>
          </View>
        ) : error && !data ? (
          <Card>
            <Feather name="alert-circle" size={24} color={colors.HIGH} />
            <Text style={styles.errTitle}>Tracking Unavailable</Text>
            <Text style={styles.errBody}>{error}</Text>
            <View style={{ marginTop: 12 }}>
              <ActionButton label="RETRY" color={colors.primary} onPress={fetchTracking} />
            </View>
          </Card>
        ) : (
          <>
            {/* 1. STATUS HEADER CARD */}
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusLeft}>
                  <Text style={styles.statusKicker}>DISPATCH STATUS</Text>
                  <Text style={styles.statusTitle}>
                    {reqStatus === 'EN_ROUTE'
                      ? 'RESPONDER EN ROUTE'
                      : reqStatus === 'ARRIVED'
                      ? 'RESPONDER ARRIVED'
                      : reqStatus === 'ACCEPTED'
                      ? 'RESPONDER ASSIGNED'
                      : reqStatus === 'MATCHED'
                      ? 'RESPONDER MATCHED'
                      : reqStatus}
                  </Text>
                </View>
                <Pill text={reqStatus} color={statusColor(reqStatus)} />
              </View>
              <Text style={styles.statusDescription}>
                {STATUS_DESCRIPTIONS[reqStatus] || 'Coordinating disaster response resources.'}
              </Text>
            </View>

            {/* 2. LIVE MAP */}
            <View style={styles.mapWrap}>
              <MapView
                height={300}
                user={userCoord}
                markers={markers}
                routeLine={routeCoords}
              />
            </View>

            {/* 3. METRICS CARD (ETA & DISTANCE) */}
            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Feather name="clock" size={18} color={colors.route} style={{ marginBottom: 4 }} />
                <Text style={styles.metricValue}>
                  {data?.eta_minutes != null ? `${data.eta_minutes} min` : isFinished ? '—' : 'Est. ~8 min'}
                </Text>
                <Text style={styles.metricLabel}>ESTIMATED ARRIVAL</Text>
              </View>

              <View style={styles.metricCard}>
                <Feather name="navigation" size={18} color="#059669" style={{ marginBottom: 4 }} />
                <Text style={styles.metricValue}>
                  {data?.distance_km != null ? `${data.distance_km} km` : isFinished ? '—' : 'Nearby'}
                </Text>
                <Text style={styles.metricLabel}>ROAD DISTANCE</Text>
              </View>
            </View>

            {/* 4. VOLUNTEER CONTACT CARD */}
            {volunteer ? (
              <Card>
                <Text style={styles.cardKicker}>ASSIGNED COMMUNITY RESPONDER</Text>
                <View style={styles.volHeader}>
                  <View style={styles.volAvatar}>
                    <Feather name="user" size={24} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.volName}>{volunteer.name}</Text>
                    <Text style={styles.volSkill}>
                      {prettyResource(volunteer.skill)} · Verified Volunteer
                    </Text>
                  </View>
                </View>

                {volunteer.phone ? (
                  <View style={styles.contactRow}>
                    <Feather name="phone" size={15} color={colors.primary} />
                    <Text style={styles.phoneText}>{volunteer.phone}</Text>
                  </View>
                ) : null}

                <View style={styles.actionRow}>
                  {volunteer.phone ? (
                    <Pressable
                      style={styles.callBtn}
                      onPress={() => handleCall(volunteer.phone)}
                    >
                      <Feather name="phone-call" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.callBtnText}>CALL RESPONDER</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            ) : (
              <Card>
                <Text style={styles.cardKicker}>COMMUNITY RESPONDER</Text>
                <Text style={styles.unmatchedText}>
                  Matching in progress. Our dispatch engine is identifying the nearest verified volunteer equipped with {prettyResource(data?.type || 'Assistance')}.
                </Text>
              </Card>
            )}

            {/* 5. REQUEST DETAILS */}
            {data?.requester?.notes || data?.requester?.description ? (
              <Card>
                <Text style={styles.cardKicker}>REPORTED NOTES</Text>
                <Text style={styles.notesText}>
                  {data.requester.notes || data.requester.description}
                </Text>
              </Card>
            ) : null}

            {actionMsg ? (
              <Text style={styles.actionErrorText}>{actionMsg}</Text>
            ) : null}

            {/* 6. LIFECYCLE ACTIONS */}
            {!isFinished && (
              <View style={styles.lifecycleButtons}>
                {reqStatus === 'ARRIVED' && (
                  <ActionButton
                    label="CONFIRM ASSISTANCE COMPLETED"
                    color={colors.LOW}
                    disabled={cancelling}
                    onPress={handleComplete}
                  />
                )}
                <ActionButton
                  label="CANCEL ASSISTANCE REQUEST"
                  color="#DC2626"
                  disabled={cancelling}
                  onPress={() => setCancelModalVisible(true)}
                />
              </View>
            )}

            <View style={{ marginTop: 12 }}>
              <ActionButton
                label="RETURN TO HOME"
                color={colors.navy}
                onPress={goBack}
              />
            </View>
          </>
        )}
      </ScrollView>

      {/* CANCEL MODAL */}
      <Modal
        visible={cancelModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Cancel Assistance Request?</Text>
            <Text style={styles.modalSubtitle}>
              Please indicate why you are cancelling this request:
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Help arrived from other source, situation safe..."
              placeholderTextColor="#94A3B8"
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setCancelModalVisible(false)}
                disabled={cancelling}
              >
                <Text style={styles.modalCancelText}>Keep Request</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmBtn}
                onPress={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm Cancel</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backBtn: {
    padding: 6,
    marginRight: 8,
  },
  scrollBody: {
    padding: 14,
  },
  loadingWrap: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.muted,
  },
  errTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.HIGH,
    marginTop: 8,
  },
  errBody: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.card,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  statusLeft: {
    flex: 1,
    paddingRight: 10,
  },
  statusKicker: {
    fontSize: 10,
    fontFamily: fonts.extrabold,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  statusTitle: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginTop: 2,
  },
  statusDescription: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: '#475569',
    lineHeight: 18,
  },
  mapWrap: {
    borderRadius: radius.card,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.card,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadow,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: fonts.extrabold,
    color: colors.text,
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: fonts.bold,
    color: colors.muted,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  cardKicker: {
    fontSize: 11,
    fontFamily: fonts.extrabold,
    color: colors.muted,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  volHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volName: {
    fontSize: 17,
    fontFamily: fonts.extrabold,
    color: colors.text,
  },
  volSkill: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.muted,
    marginTop: 2,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  phoneText: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.primary,
  },
  actionRow: {
    marginTop: 12,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.LOW,
    borderRadius: radius.button,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  callBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
  },
  unmatchedText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.muted,
    lineHeight: 19,
  },
  notesText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    lineHeight: 18,
  },
  actionErrorText: {
    color: colors.HIGH,
    fontSize: 12,
    fontFamily: fonts.semibold,
    marginVertical: 6,
    textAlign: 'center',
  },
  lifecycleButtons: {
    gap: 10,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.card,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    ...shadow,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.muted,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.text,
    textAlignVertical: 'top',
    minHeight: 70,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  modalCancelText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.muted,
  },
  modalConfirmBtn: {
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
});
