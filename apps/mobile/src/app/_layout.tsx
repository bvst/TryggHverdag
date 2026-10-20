import { Slot } from 'expo-router';
import { I18nextProvider } from 'react-i18next';

import { GroupSessionProvider } from '../features/grp';
import i18n from '../shared/translations';

/**
 * The root layout: every route renders inside it.
 *
 * The translations are initialised when their module loads, before this
 * renders, so no screen ever shows a raw key. The group session (GRP-01)
 * wraps every route, so a 401 on any of them signs the phone out once, and
 * every screen knows at once. `Slot` renders the route with no header of its
 * own: each screen says what it is in its own heading.
 */
export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <GroupSessionProvider>
        <Slot />
      </GroupSessionProvider>
    </I18nextProvider>
  );
}
