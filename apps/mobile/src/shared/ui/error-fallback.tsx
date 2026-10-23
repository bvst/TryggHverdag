/**
 * What a screen that crashed shows instead (CALL-02-AC13): one line that
 * something went wrong on this screen, "Prøv igjen", which draws the screen
 * again, and 112, because it is drawn on `Screen`.
 *
 * Expo Router draws it in place of the root layout and its providers when
 * any of them, or any route, throws while rendering (src/app/_layout.tsx
 * exports it as the ErrorBoundary). So it stands alone: it supplies its own
 * translations, the app's shared instance, and reads nothing of the group
 * session. Nothing in src/shared/ui/ can reach the session at all (an import
 * rule, CALL-02-AC13). It never shows the error: its message could hold #1's
 * number (GRP-02-AC9).
 */
import { I18nextProvider, useTranslation } from 'react-i18next';

import i18n from '../translations';
import { Button, Message } from './kit';
import { Screen } from './screen';

function SomethingWentWrong({ retry }: { retry: () => void }) {
  const { t } = useTranslation();

  return (
    <>
      <Message>{t('app.error.screen')}</Message>
      <Button label={t('app.error.retry')} onPress={retry} />
    </>
  );
}

export function ErrorFallback({ retry }: { retry: () => unknown }) {
  return (
    <I18nextProvider i18n={i18n}>
      <Screen>
        <SomethingWentWrong
          retry={() => {
            void retry();
          }}
        />
      </Screen>
    </I18nextProvider>
  );
}
