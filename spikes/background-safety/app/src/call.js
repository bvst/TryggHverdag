// SPIKE-01, S6: the call button. It dials only the synthetic number, from
// Ofcom's range reserved for drama: never 112, never an emergency number, and
// never a Norwegian one.
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

import fixed from './fixed.json';

const TEL = `tel:${fixed.syntheticNumber}`;

/**
 * Android: tries ACTION_CALL first, which starts the call on the tap if the app
 * holds CALL_PHONE. Without it Android refuses, and the app opens the dialer
 * (ACTION_VIEW), which waits for a second tap. iOS: opens the `tel:` link.
 * `report` is told which mechanism ran.
 */
export async function callSyntheticNumber(report) {
  if (Platform.OS === 'android') {
    report('trying ACTION_CALL');
    try {
      // Resolves when the call screen is left, so the report is written first.
      await IntentLauncher.startActivityAsync('android.intent.action.CALL', { data: TEL });
      report('ACTION_CALL started the call');
      return;
    } catch (error) {
      report(`ACTION_CALL refused (${error?.code ?? error?.name ?? 'error'}); opening the dialer`);
    }
  }
  try {
    await Linking.openURL(TEL);
    report(Platform.OS === 'android' ? 'dialer opened (ACTION_VIEW)' : 'tel: link opened');
  } catch (error) {
    report(`tel: link failed (${error?.name ?? 'error'})`);
  }
}
