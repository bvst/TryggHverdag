/**
 * Android's call permission, as the home screen and the setup screen need it
 * (CALL-01, approaches 3 and 4).
 *
 * `useCallPermission` reads CALL_PHONE at start and every time the app comes
 * to the foreground (AppState becomes `active`), so what the home screen says
 * comes and goes with the setting. It asks nothing by itself: the setup screen
 * asks once, when the first #1 is saved, and the line below asks when its
 * button is tapped.
 *
 * `CallPermissionLine`, under the call button while the permission is not
 * held: the button opens the dialer, where the walker taps call, and a button
 * to allow phone calls. Once Android answers `neverAskAgain`, it shows no
 * dialog any more, so the same tap opens the app's settings, and from then
 * until the app restarts or the permission is held, the button reads "Åpne
 * innstillinger" and opens them directly (CALL-01-AC4). It speaks of
 * Android's permission and Android's dialog, so on any other platform it
 * renders nothing (iOS is task 12's).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { Body, Button } from '../../shared/ui/kit';
import {
  askCallPermission,
  callPermission,
  openAppSettings,
  type CallPermission,
  type CallPermissionAnswer,
} from './phone';

export interface CallPermissionState {
  /** CALL_PHONE as last read; null until it has been. */
  permission: CallPermission | null;
  /** Android shows no dialog any more: the way left is the app's settings. */
  settingsOnly: boolean;
  /** Asks with Android's dialog, once, and reads the permission again. */
  ask: () => Promise<CallPermissionAnswer>;
}

export function useCallPermission(): CallPermissionState {
  const [permission, setPermission] = useState<CallPermission | null>(null);
  const [settingsOnly, setSettingsOnly] = useState(false);
  const mounted = useRef(true);

  const read = useCallback(async () => {
    let now: CallPermission;
    try {
      now = await callPermission();
    } catch {
      // Unread: what was last read stands.
      return;
    }
    if (mounted.current) {
      setPermission(now);
      if (now === 'granted') {
        setSettingsOnly(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void read();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [read]);

  const ask = useCallback(async (): Promise<CallPermissionAnswer> => {
    let answer: CallPermissionAnswer;
    try {
      answer = await askCallPermission();
    } catch {
      answer = 'denied';
    }
    if (answer === 'neverAskAgain' && mounted.current) {
      setSettingsOnly(true);
    }
    await read();
    return answer;
  }, [read]);

  return { permission, settingsOnly, ask };
}

/** The app's own settings page; a refusal leaves the line where it is. */
async function openSettings(): Promise<void> {
  try {
    await openAppSettings();
  } catch {
    // The line stays, and its button with it.
  }
}

/** Under the call button, while CALL_PHONE is not held: what a tap does now, and the way to change it. */
export function CallPermissionLine({ permission }: { permission: CallPermissionState }) {
  const { t } = useTranslation();

  if (Platform.OS !== 'android' || permission.permission !== 'notGranted') {
    return null;
  }
  return (
    <>
      <Body>{t('call.permission.missing')}</Body>
      {permission.settingsOnly ? (
        <Button label={t('call.permission.settings')} onPress={() => void openSettings()} quiet />
      ) : (
        <Button
          label={t('call.permission.allow')}
          onPress={() => {
            void permission.ask().then(async (answer) => {
              if (answer === 'neverAskAgain') {
                await openSettings();
              }
            });
          }}
          quiet
        />
      )}
    </>
  );
}
