/**
 * The few pieces every GRP-01 screen is built from, so each is labelled and
 * sized the same way: for night, stress and gloves (the UI rules), large
 * targets, and every control said to a screen reader as what it is.
 *
 *   - a button is a Pressable with the role "button" and a label, at least
 *     56 points tall;
 *   - a text field has its label shown above it, where it stays while text
 *     is typed (never a placeholder alone), and the same label as its
 *     screen-reader label, so a screen reader meets the field once, by name;
 *   - a heading is marked as one;
 *   - a message the app gives after an action is read out when it appears;
 *   - a request in flight shows a waiting indicator a screen reader names.
 * Every word comes from the translation files: these take text, never keys.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** A screen: safe from the notch and the system bars, and scrollable when the keyboard is up. */
export function Screen({ children }: { children?: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Heading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({ children }: { children: string }) {
  return <Text style={styles.body}>{children}</Text>;
}

/** What the app says after an action: read out when it appears. */
export function Message({ children }: { children: string }) {
  return (
    <Text accessibilityLiveRegion="polite" style={styles.message}>
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
 * names as progress, and its label, besides the dimmed button. It is an
 * accessibility element of its own (review loop 2), so a screen reader
 * stops on it and reads that label.
 */
export function Waiting({ label }: { label: string }) {
  return (
    <ActivityIndicator
      size="large"
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
} & Pick<TextInputProps, 'autoCapitalize' | 'autoComplete' | 'textContentType' | 'maxLength'>) {
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
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: '600',
  },
  body: {
    fontSize: 17,
  },
  message: {
    fontSize: 17,
    fontWeight: '600',
  },
  button: {
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f4e79',
  },
  quietButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#1f4e79',
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
    color: '#ffffff',
  },
  quietButtonText: {
    color: '#1f4e79',
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
  },
  field: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: '#5a5a5a',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 18,
  },
});
