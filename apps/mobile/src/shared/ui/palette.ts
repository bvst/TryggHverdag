/**
 * The app's one palette (CALL-02, approach 5; Q5, D-141: always dark). Every
 * colour the app draws is here, and only here: no other file under src/ holds
 * a colour literal (CALL-02-AC7, shared/ui/source.test.ts). One palette,
 * whatever the phone's own setting, so a phone left in light mode is not a
 * bright screen in the dark.
 *
 * `contrastPairs` lists each pair of colours the app draws one on the other,
 * with the kind of pair it is; palette.test.ts holds each to WCAG 2's contrast
 * for its kind: text on a background 4.5:1, a button's text on its fill
 * 4.5:1, the call button's and the 112 button's 7:1, and a control's fill or
 * edge against the background 3:1. A colour added here is drawn in a pair
 * added below, or it is not drawn.
 */

export const palette = {
  /** Near-black: the background of every screen. */
  background: '#0b0d10',
  /** Light text on it. */
  text: '#f2f2f2',
  /** The accent: a button's fill, a quiet button's edge and text, the waiting indicator. */
  accent: '#8fd0ff',
  /** Text on the accent's fill. */
  onAccent: '#0b0d10',
  /** A text field's edge. */
  edge: '#8a8f98',
  /** The 112 button's red. */
  emergency: '#a50000',
  /** Text on the 112 red, and the 112 button's edge against the background. */
  onEmergency: '#ffffff',
} as const;

/** What a pair is, which says the contrast it must have (palette.test.ts). */
export type ContrastKind =
  'text' | 'buttonText' | 'callButtonText' | 'emergencyButtonText' | 'control';

/** Two colours the app draws, one on the other. */
export interface ContrastPair {
  name: string;
  kind: ContrastKind;
  foreground: string;
  background: string;
  /** A stricter floor than the kind's, if this pair needs one. */
  minimum?: number;
}

export const contrastPairs: readonly ContrastPair[] = [
  {
    name: 'text on the background',
    kind: 'text',
    foreground: palette.text,
    background: palette.background,
  },
  {
    name: 'a quiet button’s text on the background',
    kind: 'text',
    foreground: palette.accent,
    background: palette.background,
  },
  {
    name: 'a button’s text on its fill',
    kind: 'buttonText',
    foreground: palette.onAccent,
    background: palette.accent,
  },
  {
    name: 'the call button’s text on its fill',
    kind: 'callButtonText',
    foreground: palette.onAccent,
    background: palette.accent,
  },
  {
    name: 'the 112 button’s text on its red',
    kind: 'emergencyButtonText',
    foreground: palette.onEmergency,
    background: palette.emergency,
  },
  {
    name: 'a button’s fill, or a quiet button’s edge, against the background',
    kind: 'control',
    foreground: palette.accent,
    background: palette.background,
  },
  {
    name: 'the 112 button’s edge against the background',
    kind: 'control',
    foreground: palette.onEmergency,
    background: palette.background,
  },
  {
    name: 'a text field’s edge against the background',
    kind: 'control',
    foreground: palette.edge,
    background: palette.background,
  },
];
