// SPIKE-01: what the app shows about notifications, for the drivers to read.
// - S5: the last notification received, with the pushed payload exactly as it
//   arrived (iOS `simctl push`), so it can be compared with the fixed alert.
// - S2 on iOS: the platform's own list of delivered notifications, with the
//   time each was delivered, read whenever the app comes to the front.
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

// Shown in the foreground too, so an alert is never hidden because the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const deliveredAt = (notification) => new Date(notification.date).toISOString();

/** The content of one notification, and its pushed payload if it was a push. */
export function describe(notification) {
  const { content, trigger } = notification.request;
  return {
    title: content.title,
    body: content.body,
    data: content.data,
    payload: trigger?.type === 'push' ? (trigger.payload ?? null) : undefined,
    deliveredAt: deliveredAt(notification),
  };
}

/**
 * Calls `onReceived` with each notification received or opened, and
 * `onDelivered` with the delivered list whenever the app becomes active.
 * Returns the unsubscribe.
 */
export function watchNotifications({ onReceived, onDelivered }) {
  const show = (notification) => onReceived(describe(notification));
  const readDelivered = () =>
    Notifications.getPresentedNotificationsAsync().then((list) =>
      onDelivered(
        list.map((notification) => ({
          id: notification.request.identifier,
          title: notification.request.content.title,
          deliveredAt: deliveredAt(notification),
        })),
      ),
    );
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
