/**
 * The few pieces every screen is built from, so each is labelled and sized
 * the same way: for night, stress and gloves (the UI rules), large targets,
 * and every control said to a screen reader as what it is. Moved here from
 * features/grp/ui.tsx (GRP-02, "The home screen task 2 builds", item 5), so
 * features/call and features/grp draw with the same pieces without importing
 * each other, and every colour comes from the one palette (CALL-02-AC7).
 *
 *   - a button is a Pressable with the role "button" and a label, at least
 *     56 points tall (Q6, D-141);
 *   - a text field has its label shown above it, where it stays while text
 *     is typed (never a placeholder alone), and the same label as its
 *     screen-reader label, so a screen reader meets the field once, by name;
 *   - a heading is marked as one, and says where it is drawn, so a new view
 *     inside a Screen can move the focus to it (GRP-02-AC11);
 *   - a message the app gives after an action is read out when it appears,
 *     at once when it says a call or 112 could not start;
 *   - a request in flight shows a waiting indicator a screen reader names.
 * Every word comes from the translation files: these take text, never keys.
 *
 * `Screen`, which draws the 112 bar, is in screen.tsx: features import these
 * pieces from this file, and never `Screen` (CALL-02-AC1, AC2).
 */
import { useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useScreenHeading, type HeadingRef } from './new-view';
import { palette } from './palette';

/** The least height of every control (Q6, D-141). */
export const CONTROL_MIN_HEIGHT = 56;

export function Heading({ children }: { children: string }) {
  const heading: HeadingRef = useRef(null);
  useScreenHeading(heading);

  return (
    <Text ref={heading} accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

/**
 * What the app says after an action: read out when it appears. `assertive`
 * when it must interrupt, as a call or 112 that could not start must
 * (CALL-01-AC5, CALL-02-AC5). `label`, when given, is what a screen reader
 * reads instead of the text: the same sentence with a number spelled digit
 * by digit, so it can be dialled by ear.
 */
export function Message({
  children,
  assertive = false,
  label,
}: {
  children: string;
  assertive?: boolean;
  label?: string;
}) {
  return (
    <Text
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      accessibilityLabel={label}
      style={styles.message}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** A secondary action, drawn without the fill. */
  quiet?: boolean;
}) {
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet ? styles.quietButton : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.buttonText, quiet ? styles.quietButtonText : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A request in flight (GRP-01-AC30): a spinner with the role a screen reader
 * names as progress, and its label, in the palette's accent (CALL-02-AC7). It
 * is an accessibility element of its own, so a screen reader stops on it and
 * reads that label.
 */
export function Waiting({ label }: { label: string }) {
  return (
    <ActivityIndicator
      size="large"
      color={palette.accent}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.waiting}
    />
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  ...rest
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
} & Pick<
  TextInputProps,
  'autoCapitalize' | 'autoComplete' | 'textContentType' | 'maxLength' | 'keyboardType'
>) {
  return (
    <View style={styles.fieldGroup}>
      {/* Seen, not read: the field below says the same as its own label. */}
      <Text style={styles.fieldLabel} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        style={styles.field}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 28,
    fontWeight: '600',
    color: palette.text,
  },
  body: {
    fontSize: 17,
    color: palette.text,
  },
  message: {
    fontSize: 17,
    fontWeight: '600',
    color: palette.text,
  },
  button: {
    minHeight: CONTROL_MIN_HEIGHT,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
  },
  quietButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: palette.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: palette.onAccent,
  },
  quietButtonText: {
    color: palette.accent,
  },
  waiting: {
    paddingVertical: 8,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: palette.text,
  },
  field: {
    minHeight: CONTROL_MIN_HEIGHT,
    borderWidth: 2,
    borderColor: palette.edge,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 18,
    color: palette.text,
  },
});
