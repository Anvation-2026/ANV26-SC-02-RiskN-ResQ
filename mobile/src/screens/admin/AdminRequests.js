import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Header from '../../components/Header';
import { Card, ErrorText, Pill, StateView, statusColor } from '../../components/ui';
import { FadeIn, staggerDelay } from '../../components/motion';
import usePolling from '../../hooks/usePolling';
import { getHelpRequests, getMatches } from '../../services/accountApi';
import { timeAgo } from '../../services/geo';
import { prettyResource } from '../../integration/volunteerAdapter';
import { colors, fonts } from '../../theme';

export default function AdminRequests() {
  const reqs = usePolling(getHelpRequests, 6000);
  const matches = usePolling(getMatches, 6000);
  return (
    <View style={{ flex: 1 }}>
      <Header title="Requests" subtitle="Help requests and volunteer matches" />
      <ScrollView contentContainerStyle={styles.body}>
        {reqs.data == null && reqs.error ? <StateView kind="error" title="Unable to load help requests." message={reqs.error} onRetry={reqs.reload} /> : <ErrorText>{reqs.error || matches.error}</ErrorText>}
        {reqs.data == null && !reqs.error ? <StateView kind="loading" /> : null}
        <Text style={styles.section}>Help requests ({(reqs.data || []).length})</Text>
        {reqs.data && reqs.data.length === 0 && <StateView kind="empty" compact icon="life-buoy" title="No help requests yet." message="Requests from people in the area appear here with their status and volunteer." />}
        {(reqs.data || []).map((r, i) => (
          <FadeIn key={r.id} delay={staggerDelay(i, 50, 300)}><Card>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{prettyResource(r.type)} · #{r.id}</Text>
              <Pill text={r.status} color={statusColor(r.status)} />
            </View>
            <Text style={styles.line}>Priority {r.priority} · {r.requester_name || `user #${r.user_id}`}{r.requester_phone ? ` (${r.requester_phone})` : ''} · {timeAgo(r.created_at)}</Text>
            {r.volunteer_name ? <Text style={styles.line}>Volunteer: {r.volunteer_name}{r.match_status ? ` (${r.match_status.toLowerCase()})` : ''}</Text> : null}
          </Card></FadeIn>
        ))}
        <Text style={styles.section}>Matches ({(matches.data || []).length})</Text>
        {matches.data && matches.data.length === 0 && <StateView kind="empty" compact icon="link" title="No matches yet." />}
        {(matches.data || []).map((m) => (
          <Card key={m.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>{m.volunteer_name} → request #{m.help_request_id}</Text>
              <Pill text={m.status} color={statusColor(m.status)} />
            </View>
            <Text style={styles.line}>{prettyResource(m.request_type)} · priority {m.request_priority} · {timeAgo(m.created_at)}</Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40 },
  section: { fontFamily: fonts.extrabold, fontSize: 16, color: colors.text, marginVertical: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  line: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: 4 },
});
