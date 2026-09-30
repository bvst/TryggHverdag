// SPIKE-01: the journey screen. It shows counts, names and codes for the
// drivers to read, and never a position.
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

const line = (value) => (value === null || value === undefined ? '-' : String(value));

export function JourneyScreen({ state, problem, received, delivered, callResult, actions }) {
  const { status } = state;
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>SPIKE-01 journey</Text>
      {problem !== null && (
        <Text testID="problem" style={styles.problem}>
          Setup failed: {problem}
        </Text>
      )}

      <View style={styles.row}>
        <Button testID="start-journey" title="Start journey" onPress={actions.start} />
        <Button testID="stop-journey" title="Stop journey" onPress={actions.stop} />
      </View>

      <Text testID="journey-state">
        journey: {state.enabled ? 'on' : 'off'} · motion:{' '}
        {state.moving === null ? '-' : state.moving ? 'moving' : 'stationary'}
      </Text>
      <Text testID="journey-counts">
        locations {state.locations} · heartbeats {state.heartbeats} · uploads ok {state.uploadsOk} ·
        failed {state.uploadsFailed} · last HTTP {line(state.lastUploadStatus)}
      </Text>
      <Text testID="journey-status">
        queue {line(status?.queueCount)} · permission {line(status?.permission)} · exempt{' '}
        {line(status?.exempt)} · last report {line(state.lastReport)}
      </Text>

      <Text style={styles.heading}>Events</Text>
      <Text testID="events">{state.notes.length === 0 ? '-' : state.notes.join('\n')}</Text>

      <Text style={styles.heading}>Call (S6)</Text>
      <Button testID="call" title="Call the synthetic number" onPress={actions.call} />
      <Text testID="call-result">{line(callResult)}</Text>

      <Text style={styles.heading}>Alert (S5)</Text>
      <Button testID="alert-soon" title="Post the alert in 10 s" onPress={actions.alert} />
      <Text testID="received">{received === null ? '-' : JSON.stringify(received)}</Text>

      <Text style={styles.heading}>Delivered notifications</Text>
      <Button testID="refresh-delivered" title="Refresh" onPress={actions.refreshDelivered} />
      <Text testID="delivered">
        {delivered.length === 0
          ? '-'
          : delivered.map((item) => `${item.deliveredAt} ${item.id} ${item.title}`).join('\n')}
      </Text>

      <Text style={styles.heading}>Map (S8)</Text>
      <Button testID="open-map" title="Open the map" onPress={actions.openMap} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  title: { fontSize: 20, fontWeight: 'bold' },
  heading: { fontSize: 16, fontWeight: 'bold', marginTop: 12 },
  row: { flexDirection: 'row', gap: 12 },
  problem: { color: '#b00020' },
});
