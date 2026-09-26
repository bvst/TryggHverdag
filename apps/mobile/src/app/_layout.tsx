import { Slot } from 'expo-router';
import { I18nextProvider } from 'react-i18next';

import i18n from '../shared/translations';

/**
 * The root layout: every route renders inside it.
 *
 * The translations are initialised when their module loads, before this
 * renders, so no screen ever shows a raw key. `Slot` renders the route with no
 * header of its own: the placeholder screen has nothing to navigate to.
 */
export default function RootLayout() {
  return (
    <I18nextProvider i18n={i18n}>
      <Slot />
    </I18nextProvider>
  );
}
