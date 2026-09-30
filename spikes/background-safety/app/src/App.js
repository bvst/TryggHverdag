// SPIKE-01: the app. Two screens, switched with plain state (no router). The
// SDK's listeners live here, not in a screen, so opening the map never stops
// the reminder from moving.
import { useEffect, useRef, useState } from 'react';

import { callSyntheticNumber } from './call';
import { alertSoon, live, prepare, startJourney, stopJourney, watch } from './journey';
import { JourneyScreen } from './JourneyScreen';
import { MapScreen } from './MapScreen';
import { watchNotifications } from './notifications';

export default function App() {
  const [screen, setScreen] = useState('journey');
  const [state, setState] = useState({ ...live });
  const [problem, setProblem] = useState(null);
  const [received, setReceived] = useState(null);
  const [delivered, setDelivered] = useState([]);
  const [callResult, setCallResult] = useState(null);
  const notifications = useRef(null);

  useEffect(() => {
    const unwatch = watch(setState);
    let unsubscribe = () => {};
    prepare().then(
      (remove) => {
        unsubscribe = remove;
      },
      (error) => setProblem(String(error?.message ?? error)),
    );
    notifications.current = watchNotifications({
      onReceived: setReceived,
      onDelivered: setDelivered,
    });
    return () => {
      unwatch();
      unsubscribe();
      notifications.current?.remove();
    };
  }, []);

  /** Every action reports its own failure on the screen: nothing fails silently. */
  const guarded = (label, fn) => () =>
    Promise.resolve()
      .then(fn)
      .catch((error) => setProblem(`${label}: ${String(error?.message ?? error)}`));

  if (screen === 'map') return <MapScreen onBack={() => setScreen('journey')} />;
  return (
    <JourneyScreen
      state={state}
      problem={problem}
      received={received}
      delivered={delivered}
      callResult={callResult}
      actions={{
        start: guarded('start', startJourney),
        stop: guarded('stop', stopJourney),
        call: guarded('call', () => callSyntheticNumber(setCallResult)),
        alert: guarded('alert', alertSoon),
        refreshDelivered: guarded('delivered', () => notifications.current?.refresh()),
        openMap: () => setScreen('map'),
      }}
    />
  );
}
