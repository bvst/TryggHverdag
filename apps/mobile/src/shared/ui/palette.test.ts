// CALL-02-AC7 (L5): every screen is dark, and readable at night. Always dark
// (Q5, D-141): one palette, src/shared/ui/palette.ts, with a near-black
// background, light text, the accent, and the 112 red, and the list of the
// colour pairs the app draws, each with the contrast it must meet. This
// computes WCAG 2's contrast for every pair the palette lists:
//   - text on a background: at least 4.5:1;
//   - a button's text on its fill: at least 4.5:1, and at least 7:1 for the
//     call button's and the 112 button's;
//   - a control's fill or edge against the background: at least 3:1.
//
// The shape is fixed here for the palette and this test to share:
//   - `palette`: the colours by role, `background`, `text`, `accent` and
//     `emergency` among them, each an opaque hex colour;
//   - `contrastPairs`: each pair the app draws, `{ name, kind, foreground,
//     background }`, `kind` being one of KINDS below, and, if a pair carries
//     a `minimum` of its own, it may only be stricter than its kind's.
//
// No colour is written in this file: no file in apps/mobile/src/ but
// palette.ts holds a colour literal (source.test.ts holds that). The contrast
// formula is checked on numbers instead.
//
// The module is loaded in each test, so each reports its own failure while it
// does not exist yet.
import { describe, expect, jest, test } from '@jest/globals';

/** Each kind of pair, and the least contrast WCAG 2 lets it have here (CALL-02-AC7). */
const KINDS = {
  text: 4.5,
  buttonText: 4.5,
  callButtonText: 7,
  emergencyButtonText: 7,
  control: 3,
} as const;

type Kind = keyof typeof KINDS;

interface ContrastPair {
  name: string;
  kind: Kind;
  foreground: string;
  background: string;
  minimum?: number;
}

interface PaletteModule {
  palette: Record<string, unknown>;
  contrastPairs: readonly ContrastPair[];
}

function load(): PaletteModule {
  const loaded: PaletteModule = jest.requireActual('./palette');
  return loaded;
}

/** An opaque hex colour, #rgb or #rrggbb, as its three channels, 0 to 255; anything else throws. */
function channels(colour: string): [number, number, number] {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(colour);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  const parts = short?.slice(1).map((digit) => digit + digit) ?? long?.slice(1);
  if (parts?.length !== 3) {
    throw new Error(`${colour} is not an opaque hex colour, #rgb or #rrggbb`);
  }
  const [r, g, b] = parts.map((part) => parseInt(part, 16));
  return [r ?? 0, g ?? 0, b ?? 0];
}

/** WCAG 2's relative luminance of three channels, 0 to 255. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio between two luminances. */
function ratio(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const contrast = (one: string, other: string): number =>
  ratio(luminance(channels(one)), luminance(channels(other)));

describe('CALL-02-AC7: the palette, and the contrast of every pair it lists', () => {
  test('CALL-02-AC7: the contrast formula is WCAG 2’s: white on black is 21:1, a colour on itself 1:1', () => {
    expect(ratio(luminance([255, 255, 255]), luminance([0, 0, 0]))).toBeCloseTo(21, 5);
    expect(ratio(luminance([118, 118, 118]), luminance([118, 118, 118]))).toBe(1);
    // #767676 on white is the well-known 4.54:1.
    expect(ratio(luminance([118, 118, 118]), luminance([255, 255, 255]))).toBeCloseTo(4.54, 2);
  });

  test('CALL-02-AC7: the palette has a background, a text colour, an accent and the 112 red, each an opaque hex colour', () => {
    const { palette } = load();

    for (const role of ['background', 'text', 'accent', 'emergency']) {
      const colour = palette[role];
      expect({ role, colour: typeof colour }).toEqual({ role, colour: 'string' });
      expect(() => channels(String(colour))).not.toThrow();
    }
  });

  test('CALL-02-AC7: always dark: the background is near-black, and the text on it light', () => {
    const { palette } = load();

    expect(luminance(channels(String(palette['background'])))).toBeLessThan(0.03);
    expect(luminance(channels(String(palette['text'])))).toBeGreaterThan(0.5);
  });

  test('CALL-02-AC7: the 112 colour is a red: its red channel at least twice its green and its blue', () => {
    const [r, g, b] = channels(String(load().palette['emergency']));

    expect(r).toBeGreaterThanOrEqual(2 * g);
    expect(r).toBeGreaterThanOrEqual(2 * b);
    expect(r).toBeGreaterThan(100);
  });

  test('CALL-02-AC7: the palette lists the pairs the app draws, at least one of every kind: text on a background, a button’s text on its fill, the call button’s, the 112 button’s, and a control against the background', () => {
    const { contrastPairs } = load();

    expect(contrastPairs.length).toBeGreaterThan(0);
    expect([...new Set(contrastPairs.map((pair) => pair.kind))].sort()).toEqual(
      Object.keys(KINDS).sort(),
    );
  });

  test('CALL-02-AC7: every pair is drawn in the palette’s own colours', () => {
    const { palette, contrastPairs } = load();
    const colours = Object.values(palette)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    for (const pair of contrastPairs) {
      expect({
        pair: pair.name,
        foreground: colours.includes(pair.foreground.toLowerCase()),
        background: colours.includes(pair.background.toLowerCase()),
      }).toEqual({ pair: pair.name, foreground: true, background: true });
    }
  });

  test('CALL-02-AC7: the 112 button’s text is drawn on the 112 red', () => {
    const { palette, contrastPairs } = load();
    const emergency = contrastPairs.filter((pair) => pair.kind === 'emergencyButtonText');

    expect(emergency.length).toBeGreaterThan(0);
    expect(emergency.map((pair) => pair.background.toLowerCase())).toContain(
      String(palette['emergency']).toLowerCase(),
    );
  });

  test('CALL-02-AC7: every pair meets its kind’s contrast: 4.5:1 for text and a button’s text, 7:1 for the call button’s and the 112 button’s, 3:1 for a control against the background; a pair’s own minimum may only be stricter', () => {
    const { contrastPairs } = load();

    expect(contrastPairs.length).toBeGreaterThan(0);
    for (const pair of contrastPairs) {
      const floor = KINDS[pair.kind];
      expect({ pair: pair.name, kind: pair.kind, known: typeof floor === 'number' }).toEqual({
        pair: pair.name,
        kind: pair.kind,
        known: true,
      });
      if (pair.minimum !== undefined) {
        expect({ pair: pair.name, minimum: pair.minimum >= floor }).toEqual({
          pair: pair.name,
          minimum: true,
        });
      }
      const measured = contrast(pair.foreground, pair.background);
      expect({
        pair: pair.name,
        measured: Math.round(measured * 100) / 100,
        meets: measured >= Math.max(floor, pair.minimum ?? 0),
      }).toEqual({ pair: pair.name, measured: Math.round(measured * 100) / 100, meets: true });
    }
  });
});
