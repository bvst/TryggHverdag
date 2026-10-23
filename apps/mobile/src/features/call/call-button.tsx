/**
 * The call button (CALL-01, approach 5): the largest element on the home
 * screen, at least 120 dp tall and the content's full width (Q6, D-141), so it
 * is easy to hit one-handed with gloves.
 *
 * With #1 it reads "Ring {name}", and a screen reader hears "Ring {name}" and
 * the hint "Ringer" with the number digit by digit (CALL-01-AC8). One tap
 * calls #1 through the phone module (phone.ts): at once with Android's call
 * permission, through the dialer without it, and the dialer always for an
 * emergency number (CALL-01-AC2, AC4). It asks nothing of the server, and
 * reads nothing of a journey (CALL-01-AC6).
 *
 * One call at a time: a tap while a call is being started starts no second
 * one. "Being started" ends when the phone module settles, or when the app
 * next comes to the foreground, whichever is first, so a start that never
 * settles cannot leave the button dead (CALL-01-AC2). A call the phone could
 * not start is said at once, with the number, so the walker can dial it by
 * hand, and the button stays (CALL-01-AC5).
 *
 * Without #1, it is the same button, the same size and in the same place, and
 * says what is missing, with the line under it its caller gives; a tap does
 * what its caller says, and never calls anyone (GRP-02-AC1, AC8).
 *
 * Its text grows with the phone's font size and wraps, never cut off: no
 * numberOfLines, no allowFontScaling={false} (CALL-01-AC8).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Message } from '../../shared/ui/kit';
import { palette } from '../../shared/ui/palette';
import { callNumber } from './phone';

/** The call button's least height: taller than every other control (Q6, D-141). */
const CALL_BUTTON_MIN_HEIGHT = 120;

/** A number as a screen reader should read it: each character apart, `+123` as `+ 1 2 3`. */
export function spelledNumber(number: string): string {
  return Array.from(number).join(' ');
}

/** Who the button calls: #1's name and number, as GRP-02 keeps them. */
export interface Callee {
  name: string;
  number: string;
}

export type CallButtonProps =
  | { callee: Callee }
  | {
      callee: null;
      /** What the button says is missing. */
      title: string;
      /** The line under it: how to set it. */
      line: string;
      onPress: () => void;
    };

/** The button itself: the same Pressable, size and place, with #1 or without. */
function LargeButton({
  label,
  hint,
  title,
  line,
  onPress,
}: {
  label: string;
  hint: string;
  title: string;
  line?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Text style={styles.title}>{title}</Text>
      {line === undefined ? null : <Text style={styles.line}>{line}</Text>}
    </Pressable>
  );
}

/** The call to #1, one at a time, and what the phone could not start. */
function CallingButton({ callee }: { callee: Callee }) {
  const { t } = useTranslation();
  /** The call being started, by its count; null when none is. */
  const starting = useRef<number | null>(null);
  const count = useRef(0);
  const [failedNumber, setFailedNumber] = useState<string | null>(null);

  useEffect(() => {
    // Back in the foreground: whatever was being started is over, as far as
    // the button goes, though its promise may never settle.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        starting.current = null;
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const call = () => {
    if (starting.current !== null) {
      return;
    }
    count.current += 1;
    const attempt = count.current;
    starting.current = attempt;
    setFailedNumber(null);
    const { number } = callee;
    callNumber(number).then(
      () => {
        if (starting.current === attempt) {
          starting.current = null;
        }
      },
      () => {
        // Not kept, and not logged: the error's message may hold the number.
        if (starting.current === attempt) {
          starting.current = null;
        }
        if (count.current === attempt) {
          setFailedNumber(number);
        }
      },
    );
  };

  return (
    <View style={styles.group}>
      <LargeButton
        label={t('call.button.call', { name: callee.name })}
        hint={t('call.button.hint', { number: spelledNumber(callee.number) })}
        title={t('call.button.call', { name: callee.name })}
        onPress={call}
      />
      {failedNumber === callee.number ? (
        <Message assertive>{t('call.button.failed', { number: callee.number })}</Message>
      ) : null}
    </View>
  );
}

export function CallButton(props: CallButtonProps) {
  if (props.callee !== null) {
    return <CallingButton callee={props.callee} />;
  }
  return (
    <View style={styles.group}>
      <LargeButton
        label={props.title}
        hint={props.line}
        title={props.title}
        line={props.line}
        onPress={props.onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 8,
  },
  button: {
    minHeight: CALL_BUTTON_MIN_HEIGHT,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    color: palette.onAccent,
  },
  line: {
    fontSize: 17,
    textAlign: 'center',
    color: palette.onAccent,
  },
});
