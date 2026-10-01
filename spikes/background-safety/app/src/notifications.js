// SPIKE-01: what the app shows about notifications, for the drivers to read.
// - S5: the last notification received, with the pushed payload exactly as it
//   arrived (iOS `simctl push`), so it can be compared with the fixed alert.
// - S2 on iOS: the platform's own list of delivered notifications, with the
//   time each was delivered, read whenever the app comes to the front.
// Both are also written to evidence files (see ./evidence.js).
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { EVIDENCE, record } from './evidence';

// Shown in the foreground too, so an alert is never hidden because the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * When the notification was delivered, in ms since the epoch. expo-notifications
 * gives iOS's time in seconds (`timeIntervalSince1970`) and Android's in ms
 * (`getTime()`); everything downstream gets ms.
 */
export const deliveredAtMs = (notification) =>
  Platform.OS === 'ios' ? Math.round(notification.date * 1000) : notification.date;

/** The content of one notification, and its pushed payload if it was a push. */
export function describe(notification) {
  const { content, trigger } = notification.request;
  return {
    id: notification.request.identifier,
    title: content.title,
    body: content.body,
    data: content.data,
    payload: trigger?.type === 'push' ? (trigger.payload ?? null) : undefined,
    deliveredAt: deliveredAtMs(notification),
  };
}

/**
 * Calls `onReceived` with each notification received or opened, and
 * `onDelivered` with the delivered list whenever the app becomes active.
 * Returns the refresh and the unsubscribe.
 */
export function watchNotifications({ onReceived, onDelivered }) {
  const show = (notification) => {
    const described = describe(notification);
    record(EVIDENCE.received, { notification: described });
    onReceived(described);
  };
  const readDelivered = () =>
    Notifications.getPresentedNotificationsAsync().then((list) => {
      const delivered = list.map((notification) => ({
        id: notification.request.identifier,
        title: notification.request.content.title,
        deliveredAt: deliveredAtMs(notification),
      }));
      record(EVIDENCE.delivered, { delivered });
      onDelivered(delivered);
    });
  const subscriptions = [
    Notifications.addNotificationReceivedListener(show),
    Notifications.addNotificationResponseReceivedListener((response) =>
      show(response.notification),
    ),
    AppState.addEventListener('change', (state) => {
      if (state === 'active') readDelivered();
    }),
  ];
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) show(response.notification);
  });
  readDelivered();
  return { refresh: readDelivered, remove: () => subscriptions.forEach((s) => s.remove()) };
}
