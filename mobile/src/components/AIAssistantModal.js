import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getSuggestedQuestions, sendChatMessage } from '../services/api';
import { colors, fonts, palette, radius, riskColor, riskSoft, riskSurface, shadow } from '../theme';
import { FadeIn, Pulse } from './motion';

// Session-level persistent message store across open/minimize/close cycles
let sessionMessagesStore = [];

const DEFAULT_SUGGESTIONS = [
  'Check my flood risk',
  'Why is my risk high?',
  'Nearby shelters',
  'Current rainfall',
  'Safety advice',
  'Which roads should I avoid?',
];

// Animated 3-dot typing wave indicator
function TypingWaveDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateDot = (val, delay) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 350,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(val, {
            toValue: 0,
            duration: 350,
            easing: Easing.in(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.delay(Math.max(0, 700 - delay)),
        ])
      );
    };

    const l1 = animateDot(dot1, 0);
    const l2 = animateDot(dot2, 180);
    const l3 = animateDot(dot3, 360);

    l1.start();
    l2.start();
    l3.start();

    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [dot1, dot2, dot3]);

  const translateY1 = dot1.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const translateY2 = dot2.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const translateY3 = dot3.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const opacity1 = dot1.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const opacity2 = dot2.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const opacity3 = dot3.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={styles.waveContainer}>
      <Animated.View style={[styles.waveDot, { opacity: opacity1, transform: [{ translateY: translateY1 }] }]} />
      <Animated.View style={[styles.waveDot, { opacity: opacity2, transform: [{ translateY: translateY2 }] }]} />
      <Animated.View style={[styles.waveDot, { opacity: opacity3, transform: [{ translateY: translateY3 }] }]} />
      <Text style={styles.waveText}>Analyzing live hydrometry...</Text>
    </View>
  );
}

// Format markdown text spans
function FormattedText({ text, style }) {
  if (!text) return null;
  const lines = text.split('\n');

  return (
    <View style={styles.formattedContainer}>
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <View key={lineIdx} style={{ height: 5 }} />;
        }

        // Section Headers
        if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
          const headerText = trimmed.replace(/^#+\s*/, '');
          return (
            <Text key={lineIdx} style={[styles.mdHeader, style]}>
              {headerText}
            </Text>
          );
        }

        // Bullet items
        const isBullet = trimmed.startsWith('• ') || trimmed.startsWith('* ') || trimmed.startsWith('- ');
        const content = isBullet ? trimmed.replace(/^[•*-]\s*/, '') : trimmed;

        // Parse bold segments **bold**
        const parts = content.split(/(\*\*[^*]+\*\*)/g);

        return (
          <View key={lineIdx} style={[styles.lineRow, isBullet && styles.bulletRow]}>
            {isBullet && (
              <View style={styles.bulletDotWrap}>
                <View style={styles.bulletDot} />
              </View>
            )}
            <Text style={[styles.mdBody, style, isBullet && styles.bulletText]}>
              {parts.map((part, partIdx) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return (
                    <Text key={partIdx} style={styles.mdBold}>
                      {part.slice(2, -2)}
                    </Text>
                  );
                }
                return <Text key={partIdx}>{part}</Text>;
              })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// Risk badge component with glowing accent
function AssistantRiskBadge({ badge }) {
  if (!badge || !badge.level) return null;
  const color = riskColor(badge.level);
  const bg = riskSoft(badge.level);

  return (
    <View style={[styles.badgeWrap, { backgroundColor: bg, borderColor: color }]}>
      <View style={[styles.badgeIconDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeLevelText, { color }]}>
        {badge.level} RISK {badge.score != null ? `(${Math.round(badge.score)}/100)` : ''}
      </Text>
      {badge.confidence ? (
        <Text style={[styles.badgeConfidenceText, { color }]}>
          • {badge.confidence}
        </Text>
      ) : null}
      {badge.freshness ? (
        <Text style={styles.badgeFreshnessText}>• {badge.freshness}</Text>
      ) : null}
    </View>
  );
}

// Source citation cards
function AssistantSources({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <View style={styles.sourcesContainer}>
      <View style={styles.sourcesHeaderRow}>
        <Feather name="shield" size={10} color="#38BDF8" style={{ marginRight: 4 }} />
        <Text style={styles.sourcesTitle}>WHERE THIS ANSWER COMES FROM</Text>
      </View>
      <View style={styles.sourcesGrid}>
        {sources.map((s, idx) => {
          const isLive = ['Active', 'ONLINE', 'Current', 'Reference', 'Standard', 'Static'].includes(s.status);
          return (
            <View key={idx} style={styles.sourceCard}>
              <View style={styles.sourceHeader}>
                <Text style={styles.sourceName} numberOfLines={1}>{s.title}</Text>
              </View>
              <Text style={styles.sourceType} numberOfLines={2}>{s.type}{s.detail ? ` · ${s.detail}` : ''}</Text>
              {s.category ? <Text style={[styles.sourceType, { fontWeight: '800', color: KIND_COLOR[s.category] || '#94A3B8' }]}>{s.category}</Text> : null}
              <View style={[styles.statusTag, {
                backgroundColor: isLive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                borderColor: isLive ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)',
              }]}>
                <View style={[styles.statusDot, { backgroundColor: isLive ? '#10B981' : '#F59E0B' }]} />
                <Text style={[styles.statusTagText, { color: isLive ? '#34D399' : '#FBBF24' }]}>
                  {s.status}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// what kind of data each source is: observed, modelled, historical, a drill, or static reference
const KIND_COLOR = { REAL: '#34D399', MODELLED: '#A78BFA', HISTORICAL: '#22D3EE', SIMULATED: '#C084FC', STATIC: '#94A3B8' };

// Action button pills
function AssistantActions({ actions, onTriggerAction }) {
  if (!actions || actions.length === 0) return null;

  return (
    <View style={styles.actionsWrap}>
      {actions.map((act, idx) => (
        <Pressable
          key={idx}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          onPress={() => onTriggerAction(act)}
        >
          <Feather name="arrow-up-right" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
          <Text style={styles.actionBtnText}>{act.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function AIAssistantModal({ visible, onClose, onNavigate, initialQuestion, onInitialQuestionSent }) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { user } = useAuth();
  const { userLocation } = useData() || {}; // the volunteer portal has no DataProvider: never destructure null

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(sessionMessagesStore);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState(DEFAULT_SUGGESTIONS);
  const [modalRendered, setModalRendered] = useState(visible);

  const scrollViewRef = useRef(null);

  // Animation values for smooth floating widget entry/exit
  const animScale = useRef(new Animated.Value(0.9)).current;
  const animOpacity = useRef(new Animated.Value(0)).current;
  const animTranslateY = useRef(new Animated.Value(24)).current;
  const isAnimatingClose = useRef(false);

  const role = user?.role || 'user';
  const roleLabel = role === 'admin' ? 'COMMAND' : role === 'volunteer' ? 'RESPONDER' : 'CITIZEN';

  // Responsive widget sizing
  const isWebDesktop = Platform.OS === 'web' && windowWidth >= 768;
  const widgetWidth = isWebDesktop
    ? Math.min(410, windowWidth - 32)
    : Math.min(Math.round(windowWidth * 0.90), 420);

  const widgetHeight = isWebDesktop
    ? Math.min(580, windowHeight - 90)
    : Math.round(windowHeight * 0.86); // near full screen on a phone: answers need room to be read

  const bottomMargin = isWebDesktop
    ? Math.max(insets.bottom + 20, 24)
    : Math.max(insets.bottom + 65, 80);

  const rightMargin = isWebDesktop
    ? 24
    : Math.max(12, Math.round((windowWidth - widgetWidth) / 2));

  // Sync messages with persistent session store
  useEffect(() => {
    sessionMessagesStore = messages;
  }, [messages]);

  // Open / Close animation lifecycle
  useEffect(() => {
    if (visible) {
      setModalRendered(true);
      isAnimatingClose.current = false;
      animScale.setValue(0.9);
      animOpacity.setValue(0);
      animTranslateY.setValue(24);

      Animated.parallel([
        Animated.timing(animScale, {
          toValue: 1,
          duration: 260,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(animTranslateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    }
  }, [visible, animScale, animOpacity, animTranslateY]);

  const handleSmoothClose = useCallback(() => {
    if (isAnimatingClose.current) return;
    isAnimatingClose.current = true;

    Animated.parallel([
      Animated.timing(animScale, {
        toValue: 0.9,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(animOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(animTranslateY, {
        toValue: 24,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(() => {
      setModalRendered(false);
      isAnimatingClose.current = false;
      if (onClose) onClose();
    });
  }, [animScale, animOpacity, animTranslateY, onClose]);

  // Initial welcome message (persistent across session)
  useEffect(() => {
    if (visible && messages.length === 0) {
      const welcomeText = role === 'admin'
        ? "🛡️ **RiskN AI**\n\nI answer from RiskN ResQ's own data: data-provider health, incidents, help requests, volunteers and the flood-risk estimates. If something is not in the data, I say it is unavailable."
        : role === 'volunteer'
        ? "🤝 **RiskN AI**\n\nI answer from RiskN ResQ's own data: your assignments, open requests nearby, road status and the flood risk. If something is not in the data, I say it is unavailable."
        : "🌧️ **RiskN AI**\n\nI answer from RiskN ResQ's own data: the flood-risk estimate where you are, rainfall, satellite observations (with their dates), roads and designated evacuation points. If someone is in danger, call **112** first.";

      const initialMessage = {
        id: 'welcome',
        role: 'assistant',
        content: welcomeText,
        sources: [], // nothing has been looked up yet: no source cards
        actions: [
          { label: 'Check Flood Risk', action: 'open_map', params: { layer: 'risk' } },
          { label: 'Nearest Evacuation', action: 'open_evacuation' },
        ],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages([initialMessage]);
    }
  }, [visible, messages.length, role]);

  // Fetch suggested questions
  useEffect(() => {
    if (visible) {
      getSuggestedQuestions(userLocation?.latitude, userLocation?.longitude)
        .then((res) => {
          if (res && res.questions && res.questions.length > 0) {
            const merged = Array.from(new Set([...res.questions, ...DEFAULT_SUGGESTIONS]));
            setSuggestedQuestions(merged);
          }
        })
        .catch(() => {
          setSuggestedQuestions(DEFAULT_SUGGESTIONS);
        });
    }
  }, [visible, userLocation]);

  const handleSend = useCallback(async (textToSend) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    setInput('');
    const userMsgId = String(Date.now());
    const userMsg = {
      id: userMsgId,
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setLoading(true);

    try {
      const resp = await sendChatMessage({
        message: query,
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        history: newHistory.slice(-5),
      });

      const assistantMsg = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: resp.reply,
        sources: resp.sources,
        risk_badge: resp.risk_badge,
        actions: resp.actions,
        provider: resp.provider,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      if (resp.suggested_questions && resp.suggested_questions.length > 0) {
        setSuggestedQuestions(resp.suggested_questions);
      }
    } catch (err) {
      const offlineMsg = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: "⚠️ **Server unreachable**\n\nRiskN AI cannot reach the RiskN ResQ server, so it cannot give you current data. General flood guidance (not live data):\n\n• Move away from low-lying areas if water is rising.\n• Never walk or drive through flood water.\n• Call **112** if anyone is in danger.",
        sources: [
          { title: 'Local Safety Guide', type: 'Offline Protocol', status: 'Cached' }
        ],
        actions: [
          { label: 'View Offline Safety Guide', action: 'open_safety_guide' }
        ],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, offlineMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }, [input, loading, messages, userLocation]);

  // a question tapped outside the chat (the Home quick questions) is asked as soon as the chat is open
  useEffect(() => {
    if (!visible || !initialQuestion || loading) return undefined;
    const t = setTimeout(() => { handleSend(initialQuestion); if (onInitialQuestionSent) onInitialQuestionSent(); }, 350);
    return () => clearTimeout(t);
  }, [visible, initialQuestion]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = (act) => {
    handleSmoothClose();
    if (!onNavigate) return;

    if (act.action === 'open_map') {
      onNavigate('Map', act.params);
    } else if (act.action === 'open_evacuation') {
      onNavigate('Map', { focusEvacuation: true });
    } else if (act.action === 'open_report') {
      onNavigate('Report');
    } else if (act.action === 'open_help') {
      onNavigate('Help');
    } else if (act.action === 'open_volunteer_requests') {
      onNavigate('Requests');
    } else if (act.action === 'open_admin_dashboard') {
      onNavigate('Dashboard');
    } else if (act.action === 'open_safety_guide') {
      onNavigate('Alerts'); // the safety guide lives on the Alerts screen
    } else if (act.action === 'open_home') {
      onNavigate('Home');
    }
  };

  const resetChat = () => {
    sessionMessagesStore = [];
    setMessages([]);
  };

  if (!modalRendered) return null;

  return (
    <Modal
      visible={modalRendered}
      transparent={true}
      animationType="none"
      onRequestClose={handleSmoothClose}
      statusBarTranslucent
    >
      {/* Subtle non-blocking backdrop that keeps background screen clearly visible */}
      <Pressable style={styles.backdrop} onPress={handleSmoothClose}>
        {/* Floating Mini Chat Window */}
        <Animated.View
          style={[
            styles.floatingContainer,
            {
              width: widgetWidth,
              height: widgetHeight,
              bottom: bottomMargin,
              right: rightMargin,
              opacity: animOpacity,
              transform: [
                { scale: animScale },
                { translateY: animTranslateY },
              ],
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <KeyboardAvoidingView
            style={styles.cardRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {/* High-Tech Glowing Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                {/* rq Branding Badge with glowing border */}
                <View style={styles.rqBadge}>
                  <Text style={styles.rqBadgeText}>rq</Text>
                  <View style={styles.rqGlowDot} />
                </View>
                <View>
                  <View style={styles.titleRow}>
                    <Text style={styles.headerTitle}>RiskN AI</Text>
                    <View style={styles.roleChip}>
                      <Text style={styles.roleChipText}>{roleLabel}</Text>
                    </View>
                  </View>
                  <View style={styles.statusRow}>
                    <Pulse min={0.35} duration={1200}>
                      <View style={styles.greenBeacon} />
                    </Pulse>
                    <Text style={styles.headerSubtitle}>Answers from RiskN ResQ data</Text>
                  </View>
                </View>
              </View>

              <View style={styles.headerActions}>
                {/* Clear / Reset button */}
                <Pressable
                  onPress={resetChat}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Clear conversation"
                  hitSlop={6}
                >
                  <Feather name="rotate-ccw" size={13.5} color="#94A3B8" />
                </Pressable>

                {/* Minimize button: collapses to floating bubble */}
                <Pressable
                  onPress={handleSmoothClose}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Minimize chat window"
                  hitSlop={6}
                >
                  <Feather name="minus" size={16} color="#94A3B8" />
                </Pressable>

                {/* Close button */}
                <Pressable
                  onPress={handleSmoothClose}
                  style={({ pressed }) => [styles.iconBtn, styles.closeBtn, pressed && styles.iconBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Close assistant"
                  hitSlop={6}
                >
                  <Feather name="x" size={15} color="#CBD5E1" />
                </Pressable>
              </View>
            </View>

            {/* what the answers are based on (honest: not a list of "live" feeds) */}
            <View style={styles.telemetryBar}>
              <Feather name="database" size={11} color="#94A3B8" />
              <Text style={styles.telemetryText}>Uses the app's current data for your location. Missing data is reported as missing.</Text>
            </View>

            {/* Scrollable Conversation Stream */}
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesScroll}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <FadeIn key={m.id} duration={260} distance={10}>
                    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                      {!isUser && (
                        <View style={styles.botAvatar}>
                          <Feather name="cpu" size={12} color="#22D3EE" />
                        </View>
                      )}

                      <View
                        style={[
                          styles.bubble,
                          isUser ? styles.userBubble : styles.assistantBubble,
                        ]}
                      >
                        {/* Risk Badge Header if present */}
                        {!isUser && m.risk_badge && (
                          <AssistantRiskBadge badge={m.risk_badge} />
                        )}

                        {/* Message Content */}
                        <FormattedText
                          text={m.content}
                          style={isUser ? styles.userBubbleText : styles.assistantBubbleText}
                        />

                        {/* Sources Citation Cards */}
                        {!isUser && m.sources && m.sources.length > 0 && (
                          <AssistantSources sources={m.sources} />
                        )}

                        {/* Quick Action Navigation Pills */}
                        {!isUser && m.actions && m.actions.length > 0 && (
                          <AssistantActions
                            actions={m.actions}
                            onTriggerAction={handleAction}
                          />
                        )}

                        {/* Timestamp */}
                        <Text style={[styles.timestamp, isUser ? styles.userTimestamp : styles.assistantTimestamp]}>
                          {m.timestamp} {!isUser && (m.provider && m.provider !== 'grounded_engine' ? `• worded by ${m.provider}` : '• from app data')}
                        </Text>
                      </View>
                    </View>
                  </FadeIn>
                );
              })}

              {/* Typing / Thinking Wave Indicator */}
              {loading && (
                <FadeIn duration={200} distance={8}>
                  <View style={[styles.messageRow, styles.assistantRow]}>
                    <View style={styles.botAvatar}>
                      <Feather name="cpu" size={12} color="#22D3EE" />
                    </View>
                    <View style={[styles.bubble, styles.assistantBubble, styles.loadingBubble]}>
                      <TypingWaveDots />
                    </View>
                  </View>
                </FadeIn>
              )}
            </ScrollView>

            {/* Quick Questions Suggestion Bar */}
            {suggestedQuestions.length > 0 && (
              <View style={styles.suggestedContainer}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestedScroll}
                >
                  {suggestedQuestions.map((q, idx) => (
                    <Pressable
                      key={idx}
                      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                      onPress={() => handleSend(q)}
                    >
                      <Feather name="zap" size={10} color="#22D3EE" style={{ marginRight: 4.5 }} />
                      <Text style={styles.chipText}>{q}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Bottom Input Bar */}
            <View style={styles.inputBar}>
              <View style={[styles.textInputWrap, isFocused && styles.textInputWrapFocused]}>
                <TextInput
                  style={styles.textInput}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Ask about flood risk, rain, shelters..."
                  placeholderTextColor="#64748B"
                  multiline={false}
                  returnKeyType="send"
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onKeyPress={(e) => {
                    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
                      e.preventDefault?.();
                      handleSend();
                    }
                  }}
                  onSubmitEditing={() => handleSend()}
                />
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  (!input.trim() || loading) && styles.sendBtnDisabled,
                  input.trim() && !loading && styles.sendBtnActive,
                  pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] },
                ]}
                onPress={() => handleSend()}
                disabled={!input.trim() || loading}
                accessibilityRole="button"
                accessibilityLabel="Send question"
              >
                <Feather name="arrow-up" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 11, 20, 0.35)', // subtle dimming, background page remains clearly visible
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  floatingContainer: {
    position: 'absolute',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#070E1C',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.32)',
    ...shadow,
    shadowColor: '#22D3EE',
    shadowOpacity: 0.32,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 28,
    elevation: 20,
    zIndex: 99999,
  },
  cardRoot: {
    flex: 1,
    backgroundColor: '#070E1C',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 10,
    backgroundColor: '#0B172E',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56, 189, 248, 0.16)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rqBadge: {
    width: 31,
    height: 31,
    borderRadius: 8.5,
    backgroundColor: '#1565FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
    position: 'relative',
    borderWidth: 1.2,
    borderColor: '#22D3EE',
    shadowColor: '#22D3EE',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 4,
  },
  rqBadgeText: {
    fontSize: 13.5,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  rqGlowDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 14.5,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#F8FAFC',
    letterSpacing: 0.2,
  },
  roleChip: {
    paddingHorizontal: 5.5,
    paddingVertical: 1.5,
    borderRadius: 4,
    backgroundColor: 'rgba(21,101,255,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.4)',
  },
  roleChipText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#93C5FD',
    letterSpacing: 0.4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    marginTop: 1.5,
  },
  greenBeacon: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  headerSubtitle: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#94A3B8',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.8,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  telemetryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingVertical: 4.5,
    paddingHorizontal: 8,
    backgroundColor: '#081224',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  telemetryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  telemetryDotGreen: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#10B981' },
  telemetryDotCyan: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#38BDF8' },
  telemetryDotAmber: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#F59E0B' },
  telemetryDotPurple: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#A855F7' },
  telemetryText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#94A3B8',
  },
  messagesScroll: {
    flex: 1,
    backgroundColor: '#070E1C',
  },
  messagesContent: {
    padding: 10,
    gap: 10,
  },
  messageRow: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  botAvatar: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    backgroundColor: 'rgba(34,211,238,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
    marginTop: 2,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    shadowColor: '#22D3EE',
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: '#1565FF',
    borderBottomRightRadius: 3,
    borderWidth: 0.8,
    borderColor: 'rgba(255,255,255,0.18)',
    ...shadow,
    shadowColor: '#1565FF',
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  assistantBubble: {
    backgroundColor: '#0E1A31',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.15)',
    borderBottomLeftRadius: 3,
    ...shadow,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  userBubbleText: {
    color: '#FFFFFF',
  },
  assistantBubbleText: {
    color: '#E2E8F0',
  },
  formattedContainer: {
    gap: 2.5,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletRow: {
    paddingLeft: 2,
    marginBottom: 2,
  },
  bulletDotWrap: {
    width: 12,
    paddingTop: 6,
    alignItems: 'center',
  },
  bulletDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#22D3EE',
  },
  bulletText: {
    flex: 1,
  },
  mdHeader: {
    fontSize: 12.5,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#38BDF8',
    marginTop: 4,
    marginBottom: 2,
    letterSpacing: 0.2,
  },
  mdBody: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    lineHeight: 18.5,
    color: '#CBD5E1',
  },
  mdBold: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#FFFFFF',
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7.5,
    paddingVertical: 3.5,
    marginBottom: 6,
    gap: 5,
  },
  badgeIconDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLevelText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    letterSpacing: 0.3,
  },
  badgeConfidenceText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_600SemiBold',
  },
  badgeFreshnessText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#94A3B8',
  },
  sourcesContainer: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  sourcesHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4.5,
  },
  sourcesTitle: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#94A3B8',
    letterSpacing: 0.6,
  },
  sourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  sourceCard: {
    backgroundColor: 'rgba(11, 23, 46, 0.7)',
    borderWidth: 0.8,
    borderColor: 'rgba(56, 189, 248, 0.16)',
    borderRadius: 5,
    paddingHorizontal: 6.5,
    paddingVertical: 3.5,
    minWidth: 82,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceName: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#E2E8F0',
  },
  sourceType: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#94A3B8',
    marginTop: 1,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderRadius: 2.5,
    borderWidth: 0.6,
    paddingHorizontal: 3.5,
    paddingVertical: 1,
    marginTop: 2.5,
  },
  statusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  statusTagText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
  },
  actionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E40AF',
    borderRadius: 7,
    paddingHorizontal: 9.5,
    paddingVertical: 5.5,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.45)',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  actionBtnPressed: {
    opacity: 0.8,
  },
  actionBtnText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: '#FFFFFF',
  },
  timestamp: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_500Medium',
    marginTop: 5,
  },
  userTimestamp: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'right',
  },
  assistantTimestamp: {
    color: '#64748B',
  },
  loadingBubble: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  waveDot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 2.75,
    backgroundColor: '#22D3EE',
  },
  waveText: {
    fontSize: 11,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#94A3B8',
    marginLeft: 6,
  },
  suggestedContainer: {
    paddingVertical: 6,
    backgroundColor: '#081222',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  suggestedScroll: {
    paddingHorizontal: 10,
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1E36',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    borderRadius: radius.pill,
    paddingHorizontal: 9.5,
    paddingVertical: 5,
  },
  chipPressed: {
    backgroundColor: '#1E3A8A',
    borderColor: '#38BDF8',
  },
  chipText: {
    fontSize: 10,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    color: '#E2E8F0',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0B172E',
    borderTopWidth: 1,
    borderTopColor: 'rgba(56, 189, 248, 0.16)',
    gap: 7,
  },
  textInputWrap: {
    flex: 1,
    height: 38,
    backgroundColor: '#060D1A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 19,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  textInputWrapFocused: {
    borderColor: 'rgba(34, 211, 238, 0.65)',
    shadowColor: '#22D3EE',
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  textInput: {
    color: '#FFFFFF',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    padding: 0,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1565FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: '#1565FF',
    shadowColor: '#22D3EE',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  sendBtnDisabled: {
    backgroundColor: '#142035',
    opacity: 0.5,
  },
});
