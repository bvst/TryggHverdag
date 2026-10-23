import { Slot, type ErrorBoundaryProps } from 'expo-router';
import { I18nextProvider } from 'react-i18next';
import { StatusBar } from 'react-native';

import { GroupSessionProvider } from '../features/grp';
import i18n from '../shared/translations';
import { ErrorFallback } from '../shared/ui';

/**
 * The root layout: every route renders inside it.
 *
 * The translations are initialised when their module loads, before this
 * renders, so no screen ever shows a raw key. The group session (GRP-01)
 * wraps every route, so a 401 on any of them signs the phone out once, and
 * every screen knows at once. `Slot` renders the route with no header of its
 * own: each screen says what it is in its own heading, and each route draws
 * `Screen`, with the 112 bar, around what it renders (CALL-02-AC1).
 *
 * The app is always dark (Q5, D-141): the status bar's icons are light
 * (CALL-02-AC7). The StatusBar draws nothing of the app's own, so nothing but
 * `Screen` is drawn on any screen.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar barStyle="light-content" />
      <I18nextProvider i18n={i18n}>
        <GroupSessionProvider>
          <Slot />
        </GroupSessionProvider>
      </I18nextProvider>
    </>
  );
}

/**
 * A route, this layout or one of its providers that throws while rendering
 * (CALL-02-AC13): Expo Router draws this in their place. It is drawn on
 * `Screen`, so a screen that crashed still shows 112, with a line that
 * something went wrong and "Prøv igjen", which draws them again. It stands
 * alone, outside the translations and the session above, and never shows the
 * error, whose message could hold #1's number (GRP-02-AC9).
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <ErrorFallback retry={retry} />;
}
