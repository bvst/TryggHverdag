/**
 * The 112 bar (CALL-02, approach 1): one button, "112", in red, at the top of
 * every screen, outside anything that scrolls. `Screen` (src/shared/ui/) draws
 * it unconditionally, and it takes no props, so nothing can turn it off
 * (reading 5; CALL-02-AC2's typed test holds that).
 *
 * A tap opens the phone's own dialer with 112 in it, and the walker taps call
 * there: Android's documented rule is that an app cannot use ACTION_CALL for
 * an emergency number, and the dialer is the phone's normal path, so the
 * emergency centre gets the position by AML (reading 1; Q3, D-141). It needs
 * no #1, no permission, no credential and no server (CALL-02-AC4). A dialer
 * that cannot open is said at once, and the button stays (CALL-02-AC5).
 *
 * The button is at least 64 dp tall and 96 dp wide (Q6), its text grows with
 * the phone's font size and wraps (no numberOfLines, CALL-02-AC2), and the bar
 * leaves 24 dp below it, which no scroll can take away, before the content
 * starts (CALL-01-AC1).
 */
import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Message } from '../../shared/ui/kit';
import { palette } from '../../shared/ui/palette';
import { openDialer } from './phone';

/** The number the bar dials: a constant, never a translation or a setting (CALL-02, approach 3). */
export const EMERGENCY_NUMBER = '112';

/** The space below the 112 button that no scroll can reduce (CALL-01-AC1; Q6, D-141). */
const SPACE_BELOW = 24;

/**
 * The bar. Typed as a component that takes no props, so passing it one is a
 * type error (CALL-02-AC2): nothing can be handed to it that hides 112.
 */
export const EmergencyBar: ComponentType = function EmergencyBar() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const open = () => {
    openDialer(EMERGENCY_NUMBER).then(
      () => {
        setFailed(false);
      },
      () => {
        setFailed(true);
      },
    );
  };

  return (
    <View style={styles.bar}>
      <Pressable
        role="button"
        accessibilityLabel={t('call.emergency.label')}
        accessibilityHint={t('call.emergency.hint')}
        onPress={open}
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
      >
        <Text style={styles.text}>{EMERGENCY_NUMBER}</Text>
      </Pressable>
      {failed ? <Message assertive>{t('call.emergency.failed')}</Message> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: SPACE_BELOW,
    gap: 8,
    backgroundColor: palette.background,
  },
  button: {
    alignSelf: 'flex-end',
    minHeight: 64,
    minWidth: 96,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: palette.onEmergency,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.emergency,
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    fontSize: 28,
    fontWeight: '700',
    color: palette.onEmergency,
  },
});
