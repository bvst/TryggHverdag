// BUG-70 (CI run 40469535686, job 122073049491, on 00542de, 2026-10-27):
// first-contact.yaml failed at its first step after launchApp, "Assertion is
// false: id: trygghverdag-call-button is visible", with the phone Awake, the
// app's package focused and no crash lines. The app shows the call button as
// soon as its session leaves 'starting' (the secure-storage reads), whatever
// the network does; 'starting' shows the waiting indicator (grp.waiting), and
// no credential shows the join screen (grp.join.*). Which screen it showed,
// nothing in the job log says: Maestro's debug output cannot be read from a
// session. So a failed flow now leaves the screen's name in the job log, read
// from `adb shell uiautomator dump`, without printing what is on it (PRIV-07,
// RG-07).
//
// The reader, in scripts/lib/screen-dump.mjs (the main session's design under
// D-031, pinned here):
//
//   readScreen(xml, { app, translations }) → string[]
//
// `xml` is the file `uiautomator dump` writes; `app` is the app's Android
// application ID; `translations` is nb.json, parsed (nested objects, i18next
// `{{name}}` placeholders). It returns the lines to print: one per node that
// has a non-empty resource-id, text or content-desc, in the dump's order:
//
//   - a node of the app's own package:
//       `<app>: id <resource-id, or none>; text: <what>; label: <what>`
//     where the label is the content-desc, and <what> is `none` when it is
//     empty; else the key, or keys, whose value it equals in full, named in
//     nb.json's order, joined with ` or `: the keys whose value has no
//     placeholder and equals it exactly, when there are any (an exact match
//     wins); else the keys whose value matches it with each `{{placeholder}}`
//     standing for any text of one character or more; else `other text (<n>
//     characters)`. Never the text itself;
//   - a node of another package (a permission dialog, System UI, the
//     launcher): `<package>: id <resource-id, or none>`, never its text or
//     label;
//   - when no node of the app's package has a resource-id, text or
//     content-desc, the window is blank to uiautomator, and that is said in
//     one line, first: `<app>: no node with an id, text or label`;
//   - at most 40 node lines, then `and <n> more nodes, not shown`.
//
// Text and labels are matched with XML's entities decoded, once: &amp; &lt;
// &gt; &quot; &apos; and characters by number, &#NN; and &#xNN;. Resource-ids
// and package names are code identifiers, printed as they are.
//
// Output that is not a uiautomator hierarchy, with no <hierarchy root or no
// <node in it, is refused with an error, never read as an empty screen
// (scripts/lib/call-records.mjs's house rule), and no error message repeats
// the output's text.
//
// The screens are built with the test kit's hierarchyDump, from nb.json's
// own values and the IDs the app's source holds; every name and number is the
// test kit's, synthetic. The module is imported in each test, so each reports
// a missing module on its own.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  appWindowNode,
  buttonNode,
  editTextNode,
  hierarchyDump,
  layoutNode,
  progressNode,
  textNode,
} from '../../packages/test-kit/src/android-dumps.ts';
import {
  EMULATOR_FIRST_CONTACT,
  MOBILE,
} from '../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  inGroupsOfFive,
  syntheticDisplayName,
  syntheticInvitationCode,
} from '../../packages/test-kit/src/synthetic-groups.ts';

/** The module, loaded per test. */
const screenDump = () => import('./screen-dump.mjs');

/** The app's Android application ID today (apps/mobile/app.config.ts). */
const APP = 'no.trygghverdag.placeholder';

/** The app's bokmål translations, as e2e-android.mjs reads them. */
const nb = JSON.parse(
  readFileSync(
    new URL('../../apps/mobile/src/shared/translations/nb.json', import.meta.url),
    'utf8',
  ),
);

/** A button's ID as the app's source holds it: React Native's testID, Android's resource-id. */
function idIn(file, name) {
  const source = readFileSync(
    new URL(`../../apps/mobile/src/features/call/${file}`, import.meta.url),
    'utf8',
  );
  const found = new RegExp(`\\bconst ${name} = '([^']+)';`).exec(source)?.[1];
  if (found === undefined) {
    throw new Error(`${name} is no longer a string constant in ${file}: the screens here need it`);
  }
  return found;
}

const EMERGENCY_ID = idIn('emergency-bar.tsx', 'EMERGENCY_BUTTON_ID');
const CALL_ID = idIn('call-button.tsx', 'CALL_BUTTON_ID');

/** `value` with each `{{name}}` filled with `name`, as i18next fills it. */
const filled = (value, name) => value.replaceAll(/\{\{\w+\}\}/g, name);

/** A number as a screen reader is given it: each character apart (the app's spelledNumber). */
const spelled = (number) => Array.from(number).join(' ');

/** #1, as an L7 flow chooses it: the test kit's synthetic name and number. */
const FIRST = EMULATOR_FIRST_CONTACT;

/** The 112 bar every screen draws (CALL-02): the button, its label, and its "112". */
const emergencyBar = () =>
  buttonNode({ id: EMERGENCY_ID, label: nb.call.emergency.label, texts: ['112'] });

/** One of the app's screens: its window, the 112 bar, and `content` below it. */
const appScreen = (...content) => hierarchyDump(APP, [appWindowNode([emergencyBar(), ...content])]);

/** What every screen of the app starts with: Android's content frame, and the 112 bar. */
const SCREEN_START = [
  `${APP}: id android:id/content; text: none; label: none`,
  // "Ring 1 1 2, nødnummeret" is call.emergency.label's value exactly, so
  // call.button.call's "Ring {{name}}", which matches it too, is not named:
  // an exact match wins (round 2 of the red step; RG-03 in the commit).
  `${APP}: id ${EMERGENCY_ID}; text: none; label: call.emergency.label`,
  `${APP}: id none; text: other text (3 characters); label: none`,
];

/**
 * PRIV-07: the lines holding six digits in a row of #1's number or of MOBILE,
 * whole, in groups, or spelled digit by digit. The same check as
 * scripts/e2e-android.test.mjs's numberLeaks, which cannot be imported from a
 * test file without running its tests; here no line may hold #1's either,
 * since the reader prints no Maestro command line.
 */
function numberLeaks(lines) {
  const sixDigitRuns = (number) => {
    const digits = number.replace(/\D/g, '');
    return Array.from({ length: Math.max(digits.length - 5, 0) }, (_, at) =>
      digits.slice(at, at + 6),
    );
  };
  const digitsJoined = (line) => line.replace(/(\d)[\s\-.()/]+(?=\d)/g, '$1');
  const runs = [MOBILE, FIRST.normalised].flatMap(sixDigitRuns);
  return lines.filter((line) => runs.some((run) => digitsJoined(line).includes(run)));
}

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];

/** Throws on purpose: not a missing module, and not a programming error. Returns what was thrown. */
function refuses(read, why) {
  let thrown;
  try {
    read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${why}: it read the output instead of refusing it`).toBeDefined();
  expect(
    PROGRAMMING_ERRORS.some((type) => thrown instanceof type),
    `${why}: it broke instead of refusing (${String(thrown)})`,
  ).toBe(false);
  return thrown instanceof Error ? thrown.message : String(thrown);
}

describe('BUG-70: readScreen names the screen a flow failed on by its translation keys and ids', () => {
  test('BUG-70: the fixtures are the app’s: the call button’s and 112’s IDs are read from its source, and the call button’s is the one the flows wait for', () => {
    expect(CALL_ID).toBe('trygghverdag-call-button');
    expect(EMERGENCY_ID).toMatch(/^trygghverdag-/);
    expect(EMERGENCY_ID).not.toBe(CALL_ID);
    expect(nb.grp.waiting).toEqual(expect.any(String));
    expect(nb.call.emergency.label).toEqual(expect.any(String));
  });

  test('BUG-70: the waiting indicator, the screen while secure storage is read, is named grp.waiting, below 112 named by its ID and its label’s keys, and no text is printed', async () => {
    const { readScreen } = await screenDump();

    const lines = readScreen(appScreen(progressNode(nb.grp.waiting)), {
      app: APP,
      translations: nb,
    });

    expect(lines).toEqual([...SCREEN_START, `${APP}: id none; text: none; label: grp.waiting`]);
  });

  test('BUG-70: the join screen, the screen with no credential, is named by its keys: its title, its intro, its fields’ labels, its button and its message; what was typed in a field is other text, counted, never shown', async () => {
    const { readScreen } = await screenDump();
    const code = inGroupsOfFive(syntheticInvitationCode());
    const name = syntheticDisplayName();
    const xml = appScreen(
      textNode(nb.grp.join.title),
      textNode(nb.grp.join.intro),
      textNode(nb.grp.join.codeLabel),
      editTextNode(nb.grp.join.codeLabel, code),
      textNode(nb.grp.join.nameLabel),
      editTextNode(nb.grp.join.nameLabel, name),
      buttonNode({ label: nb.grp.join.submit, texts: [nb.grp.join.submit] }),
      textNode(nb.grp.join.notValid),
    );

    const lines = readScreen(xml, { app: APP, translations: nb });

    // Not vacuous: the typed code and name have the lengths counted below.
    expect([code.length, name.length]).toEqual([23, 17]);
    expect(lines).toEqual([
      ...SCREEN_START,
      `${APP}: id none; text: grp.join.title; label: none`,
      `${APP}: id none; text: grp.join.intro; label: none`,
      `${APP}: id none; text: grp.join.codeLabel; label: none`,
      `${APP}: id none; text: other text (23 characters); label: grp.join.codeLabel`,
      `${APP}: id none; text: grp.join.nameLabel; label: none`,
      `${APP}: id none; text: other text (17 characters); label: grp.join.nameLabel`,
      `${APP}: id none; text: none; label: grp.join.submit`,
      `${APP}: id none; text: grp.join.submit; label: none`,
      `${APP}: id none; text: grp.join.notValid; label: none`,
    ]);
    expect(lines.join('\n')).not.toContain(code);
    expect(lines.join('\n')).not.toContain(name);
  });

  test('BUG-70: the home screen with no #1, the screen first-contact.yaml waits for, names the call button by its ID with its label, title and line joined, as other text with its length, and the title and line drawn in it by their keys', async () => {
    const { readScreen } = await screenDump();
    const label = `${nb.grp.firstContact.none}. ${nb.grp.firstContact.noneHint}`;
    const xml = appScreen(
      buttonNode({
        id: CALL_ID,
        label,
        texts: [nb.grp.firstContact.none, nb.grp.firstContact.noneHint],
      }),
      textNode(nb.grp.member.title),
      textNode(nb.grp.member.status),
      buttonNode({ label: nb.grp.member.invite, texts: [nb.grp.member.invite] }),
      buttonNode({ label: nb.grp.member.members, texts: [nb.grp.member.members] }),
    );

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(label).toHaveLength(81);
    expect(lines).toEqual([
      ...SCREEN_START,
      `${APP}: id trygghverdag-call-button; text: none; label: other text (81 characters)`,
      `${APP}: id none; text: grp.firstContact.none; label: none`,
      `${APP}: id none; text: grp.firstContact.noneHint; label: none`,
      `${APP}: id none; text: grp.member.title; label: none`,
      `${APP}: id none; text: grp.member.status; label: none`,
      `${APP}: id none; text: none; label: grp.member.invite`,
      `${APP}: id none; text: grp.member.invite; label: none`,
      `${APP}: id none; text: none; label: grp.member.members`,
      `${APP}: id none; text: grp.member.members; label: none`,
    ]);
  });

  test('BUG-70: a text a {{placeholder}} filled matches its key: "Nummer 1: {name}", "Ring {name}", and the call that could not start, with #1’s number in its text and spelled in its label; the number itself is other text', async () => {
    const { readScreen } = await screenDump();
    const xml = appScreen(
      textNode(filled(nb.grp.firstContact.shown, FIRST.name)),
      textNode(FIRST.normalised, spelled(FIRST.normalised)),
      buttonNode({
        id: CALL_ID,
        label: filled(nb.call.button.call, FIRST.name),
        texts: [filled(nb.call.button.call, FIRST.name)],
      }),
      textNode(
        filled(nb.call.button.failed, FIRST.normalised),
        filled(nb.call.button.failed, spelled(FIRST.normalised)),
      ),
      buttonNode({ label: nb.grp.firstContact.change, texts: [nb.grp.firstContact.change] }),
      progressNode(nb.grp.waiting),
    );

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect([FIRST.normalised.length, spelled(FIRST.normalised).length]).toEqual([13, 25]);
    expect(lines).toEqual([
      ...SCREEN_START,
      `${APP}: id none; text: grp.firstContact.shown; label: none`,
      `${APP}: id none; text: other text (13 characters); label: other text (25 characters)`,
      `${APP}: id trygghverdag-call-button; text: none; label: call.button.call`,
      `${APP}: id none; text: call.button.call; label: none`,
      `${APP}: id none; text: call.button.failed; label: call.button.failed`,
      `${APP}: id none; text: none; label: grp.firstContact.change`,
      `${APP}: id none; text: grp.firstContact.change; label: none`,
      `${APP}: id none; text: none; label: grp.waiting`,
    ]);
  });

  test('BUG-70: a placeholder stands for text at the start, in the middle and twice, and for one character or more, never for none', async () => {
    const { readScreen } = await screenDump();
    const name = syntheticDisplayName();
    const texts = [
      filled(nb.grp.members.removed, name),
      filled(nb.grp.members.confirmText, name),
      filled(nb.grp.members.remove, 'x'),
      'Ring ',
      'Fjern ',
    ];
    const xml = hierarchyDump(APP, [layoutNode(texts.map((text) => textNode(text)))]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(lines).toEqual([
      `${APP}: id none; text: grp.members.removed; label: none`,
      `${APP}: id none; text: grp.members.confirmText; label: none`,
      `${APP}: id none; text: grp.members.remove; label: none`,
      `${APP}: id none; text: other text (5 characters); label: none`,
      `${APP}: id none; text: other text (6 characters); label: none`,
    ]);
  });

  test('BUG-70: a value is matched as it is written, whole: its . ? and + are those characters, and a text with more before or after it is other text', async () => {
    const { readScreen } = await screenDump();
    const texts = [
      nb.grp.firstContact.title, // "…ringe først?"
      nb.grp.firstContact.title.replace(/t\?$/, ''), // "…ringe førs": what an unescaped ? matches
      nb.grp.firstContact.numberNotUsable, // "…gjerne med + og landskode først."
      nb.app.error.screen.replace(/\.$/, 'X'), // "…denne skjermenX": what an unescaped . matches
      `X${nb.grp.waiting}`,
      `${nb.grp.waiting}.`,
    ];
    const xml = hierarchyDump(APP, [layoutNode(texts.map((text) => textNode(text)))]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    // Not vacuous: the values hold the characters a pattern would read otherwise.
    expect(nb.grp.firstContact.title).toMatch(/t\?$/);
    expect(nb.grp.firstContact.numberNotUsable).toContain(' + ');
    expect(nb.app.error.screen).toMatch(/\.$/);
    expect(lines).toEqual([
      `${APP}: id none; text: grp.firstContact.title; label: none`,
      `${APP}: id none; text: other text (${String(texts[1]?.length)} characters); label: none`,
      `${APP}: id none; text: grp.firstContact.numberNotUsable; label: none`,
      `${APP}: id none; text: other text (${String(texts[3]?.length)} characters); label: none`,
      `${APP}: id none; text: other text (${String(texts[4]?.length)} characters); label: none`,
      `${APP}: id none; text: other text (${String(texts[5]?.length)} characters); label: none`,
    ]);
  });

  test('BUG-70: a value several keys share names every one of them, in nb.json’s order, joined with "or"', async () => {
    const { readScreen } = await screenDump();
    const xml = hierarchyDump(APP, [
      layoutNode([
        textNode(nb.grp.join.retry),
        buttonNode({ label: nb.grp.firstContact.cancel }),
        textNode(nb.grp.firstContact.nameNotUsable),
      ]),
    ]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    // Not vacuous: the values are shared.
    expect(new Set([nb.app.error.retry, nb.grp.join.retry, nb.grp.member.retry]).size).toBe(1);
    expect(nb.grp.members.cancel).toBe(nb.grp.firstContact.cancel);
    expect(nb.grp.join.nameNotUsable).toBe(nb.grp.firstContact.nameNotUsable);
    expect(lines).toEqual([
      `${APP}: id none; text: app.error.retry or grp.join.retry or grp.member.retry; label: none`,
      `${APP}: id none; text: none; label: grp.members.cancel or grp.firstContact.cancel`,
      `${APP}: id none; text: grp.join.nameNotUsable or grp.firstContact.nameNotUsable; label: none`,
    ]);
  });

  // Round 2 of the red step (the main session's answer, D-031): an exact
  // match wins. A text that equals a value with no placeholder in it is named
  // by those keys alone; keys that match only through a placeholder are named
  // when no key matches exactly, and then all of them, in nb.json's order.
  test('BUG-70: an exact match wins: a text that equals a value with no placeholder is named by those keys alone, not by the keys a placeholder lets match it; with only placeholder matches, every one is named, in nb.json’s order', async () => {
    const { readScreen } = await screenDump();
    const both = filled(nb.grp.members.removed, filled(nb.call.button.call, FIRST.name));
    const read = (texts, translations) =>
      readScreen(hierarchyDump(APP, [layoutNode(texts.map((text) => textNode(text)))]), {
        app: APP,
        translations,
      });
    const SAMPLES = {
      first: { exact: 'Ring Testa', any: 'Ring {{name}}' },
      second: { exact: 'Ring Testa', tail: '{{who}} Testa', other: 'Ring {{name}}!' },
    };

    // Not vacuous: 112's label is call.emergency.label's value, and
    // call.button.call's too, with "1 1 2, nødnummeret" for the name; and
    // "Ring Testa er fjernet fra gruppen." is call.button.call's and
    // grp.members.removed's, through a placeholder each, and no key's exactly.
    expect(nb.call.emergency.label).toBe('Ring 1 1 2, nødnummeret');
    expect(nb.call.button.call).toBe('Ring {{name}}');
    expect(both).toBe('Ring Testa er fjernet fra gruppen.');
    expect(read([nb.call.emergency.label, both], nb)).toEqual([
      `${APP}: id none; text: call.emergency.label; label: none`,
      `${APP}: id none; text: call.button.call or grp.members.removed; label: none`,
    ]);
    // "Ring Testa": two exact matches, in two places, beside two placeholder
    // ones (first.any, second.tail): both exact keys, in order, and neither of
    // the others. "Ring Ola" and "Ring Ola!": only placeholder matches, so
    // every one, in order.
    expect(read(['Ring Testa', 'Ring Ola', 'Ring Ola!'], SAMPLES)).toEqual([
      `${APP}: id none; text: first.exact or second.exact; label: none`,
      `${APP}: id none; text: first.any; label: none`,
      `${APP}: id none; text: first.any or second.other; label: none`,
    ]);
  });

  test('BUG-70: a node of another package, Android’s permission dialog, is named by its package and its ID only, never its text or label; with no node of the app that has an ID, text or label, that is said first, in one line', async () => {
    const { readScreen } = await screenDump();
    const controller = 'com.android.permissioncontroller';
    const xml = hierarchyDump(controller, [
      layoutNode(
        [
          {
            resourceId: `${controller}:id/grant_singleton`,
            children: [
              {
                className: 'android.widget.TextView',
                resourceId: `${controller}:id/permission_message`,
                text: 'Vil du la TryggHverdag ringe og administrere telefonsamtaler?',
              },
              {
                className: 'android.widget.Button',
                resourceId: `${controller}:id/permission_allow_button`,
                text: 'Tillat',
                clickable: true,
              },
              {
                className: 'android.widget.Button',
                text: 'Ikke tillat',
                contentDesc: 'Ikke tillat',
                clickable: true,
              },
            ],
          },
        ],
        'android.widget.FrameLayout',
      ),
    ]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(lines).toEqual([
      `${APP}: no node with an id, text or label`,
      `${controller}: id ${controller}:id/grant_singleton`,
      `${controller}: id ${controller}:id/permission_message`,
      `${controller}: id ${controller}:id/permission_allow_button`,
      `${controller}: id none`,
    ]);
  });

  test('BUG-70: the app’s window with no node that has an ID, text or label, blank to uiautomator, is that one line, not an empty list', async () => {
    const { readScreen } = await screenDump();
    const blank = hierarchyDump(APP, [
      layoutNode(
        [layoutNode([layoutNode()], 'android.widget.LinearLayout')],
        'android.widget.FrameLayout',
      ),
    ]);

    expect(readScreen(blank, { app: APP, translations: nb })).toEqual([
      `${APP}: no node with an id, text or label`,
    ]);
  });

  test('BUG-70: the app’s nodes and another package’s are each named their own way, in the dump’s order', async () => {
    const { readScreen } = await screenDump();
    const xml = hierarchyDump(APP, [
      appWindowNode([progressNode(nb.grp.waiting)]),
      layoutNode([
        {
          package: 'com.android.systemui',
          resourceId: 'com.android.systemui:id/notification_stack_scroller',
          children: [
            { className: 'android.widget.TextView', text: 'Tapt anrop' },
            { className: 'android.widget.TextView', resourceId: 'android:id/text', text: MOBILE },
          ],
        },
      ]),
    ]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(lines).toEqual([
      `${APP}: id android:id/content; text: none; label: none`,
      `${APP}: id none; text: none; label: grp.waiting`,
      'com.android.systemui: id com.android.systemui:id/notification_stack_scroller',
      'com.android.systemui: id none',
      'com.android.systemui: id android:id/text',
    ]);
  });
});

describe('BUG-70: readScreen reads the text as XML escapes it', () => {
  /** A dump of the app with one text node, its text attribute written as `raw`, entities and all. */
  const withRawText = (raw) => {
    const marker = 'RAW-TEXT-MARKER';
    const xml = hierarchyDump(APP, [layoutNode([textNode(marker)])]);
    expect(xml).toContain(`text="${marker}"`);
    return xml.replace(`text="${marker}"`, `text="${raw}"`);
  };
  /** The same, its content-desc. */
  const withRawLabel = (raw) => {
    const marker = 'RAW-LABEL-MARKER';
    const xml = hierarchyDump(APP, [layoutNode([textNode('', marker)])]);
    expect(xml).toContain(`content-desc="${marker}"`);
    return xml.replace(`content-desc="${marker}"`, `content-desc="${raw}"`);
  };

  const SAMPLES = {
    sample: {
      amp: 'Tom & Jerry',
      marks: 'Si "hei" <nå> og \'ha det\'',
      literal: '&lt;b&gt;',
      tag: '<b>',
      lines: 'Første linje\nAndre linje',
    },
  };

  test('BUG-70: &amp; &lt; &gt; &quot; &apos; and a line break by its number are decoded before a text is matched', async () => {
    const { readScreen } = await screenDump();
    const read = (raw) => readScreen(withRawText(raw), { app: APP, translations: SAMPLES });

    expect(read('Tom &amp; Jerry')).toEqual([`${APP}: id none; text: sample.amp; label: none`]);
    expect(read('Si &quot;hei&quot; &lt;nå&gt; og &apos;ha det&apos;')).toEqual([
      `${APP}: id none; text: sample.marks; label: none`,
    ]);
    expect(read('&lt;b&gt;')).toEqual([`${APP}: id none; text: sample.tag; label: none`]);
    expect(read('Første linje&#10;Andre linje')).toEqual([
      `${APP}: id none; text: sample.lines; label: none`,
    ]);
  });

  test('BUG-70: an entity is decoded once: "&amp;lt;b&amp;gt;" is the text "&lt;b&gt;", not "<b>"', async () => {
    const { readScreen } = await screenDump();

    expect(
      readScreen(withRawText('&amp;lt;b&amp;gt;'), { app: APP, translations: SAMPLES }),
    ).toEqual([`${APP}: id none; text: sample.literal; label: none`]);
  });

  test('BUG-70: a character by its number, decimal or hex, is decoded before a label is matched: "Ring 1 1 2, n&#248;dnummeret" is 112’s label', async () => {
    const { readScreen } = await screenDump();
    const read = (raw) => readScreen(withRawLabel(raw), { app: APP, translations: nb });
    const expected = [`${APP}: id none; text: none; label: call.emergency.label`];

    expect(nb.call.emergency.label).toBe('Ring 1 1 2, nødnummeret');
    expect(read('Ring 1 1 2, n&#248;dnummeret')).toEqual(expected);
    expect(read('Ring 1 1 2, n&#xf8;dnummeret')).toEqual(expected);
    expect(read('Ring 1 1 2, n&#xF8;dnummeret')).toEqual(expected);
    expect(read('&#82;ing 1 1 2, nødnummeret')).toEqual(expected);
  });
});

describe('BUG-70: readScreen prints at most 40 node lines', () => {
  test('BUG-70: with 45 nodes to name, the app’s and System UI’s, it prints the first 40 and then one line saying 5 more were not shown', async () => {
    const { readScreen } = await screenDump();
    const xml = hierarchyDump(
      APP,
      [
        appWindowNode(Array.from({ length: 29 }, () => textNode(nb.grp.waiting))),
        layoutNode(
          Array.from({ length: 15 }, (_, at) => ({
            resourceId: `com.android.systemui:id/slot_${String.fromCharCode(97 + at)}`,
          })),
        ),
      ].map((root, at) => (at === 1 ? { ...root, package: 'com.android.systemui' } : root)),
    );

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(lines).toHaveLength(41);
    expect(lines.slice(0, 30)).toEqual([
      `${APP}: id android:id/content; text: none; label: none`,
      ...Array.from({ length: 29 }, () => `${APP}: id none; text: grp.waiting; label: none`),
    ]);
    expect(lines.slice(30, 40)).toEqual(
      Array.from(
        { length: 10 },
        (_, at) =>
          `com.android.systemui: id com.android.systemui:id/slot_${String.fromCharCode(97 + at)}`,
      ),
    );
    expect(lines[40]).toBe('and 5 more nodes, not shown');
  });

  test('BUG-70: with exactly 40 nodes to name, it prints all 40 and no line about more', async () => {
    const { readScreen } = await screenDump();
    const xml = hierarchyDump(APP, [
      appWindowNode(Array.from({ length: 39 }, () => textNode(nb.grp.waiting))),
    ]);

    const lines = readScreen(xml, { app: APP, translations: nb });

    expect(lines).toHaveLength(40);
    expect(lines.filter((line) => /\bmore\b/.test(line))).toEqual([]);
  });
});

/**
 * Outputs that are not a uiautomator hierarchy, and what the refusal's message
 * names. Kept out of the test.each call: the test counter reads a table only
 * up to its first `)`.
 */
const NOT_A_HIERARCHY = [
  { what: 'an empty output', output: '', names: /\bhierarchy\b/i },
  {
    what: 'uiautomator’s error, with nothing dumped',
    output: 'ERROR: null root node returned by UiTestAutomationBridge.\n',
    names: /\bhierarchy\b/i,
  },
  {
    what: 'cat’s error, with no file to print',
    output: 'cat: /data/local/tmp/trygghverdag-window.xml: No such file or directory\n',
    names: /\bhierarchy\b/i,
  },
  {
    what: 'nodes with no hierarchy root',
    output: hierarchyDump(APP, [progressNode('Venter på svar')])
      .replace(/<hierarchy rotation="0">/, '')
      .replace('</hierarchy>', ''),
    names: /\bhierarchy\b/i,
  },
  {
    what: 'a hierarchy with no node',
    output:
      "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\"></hierarchy>",
    names: /\bnode\b/i,
  },
  {
    what: 'a hierarchy closed at once',
    output: "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\" />",
    names: /\bnode\b/i,
  },
];

describe('BUG-70: readScreen refuses what is not a uiautomator hierarchy, never reading it as an empty screen', () => {
  test.each(NOT_A_HIERARCHY)(
    'BUG-70: $what is refused with an error that says what it lacks',
    async ({ output, names }) => {
      const { readScreen } = await screenDump();

      const message = refuses(
        () => readScreen(output, { app: APP, translations: nb }),
        'not a hierarchy',
      );

      expect(message).toMatch(names);
    },
  );

  test('BUG-70: output that is not text at all is refused, not read', async () => {
    const { readScreen } = await screenDump();

    refuses(() => readScreen(undefined, { app: APP, translations: nb }), 'undefined');
    refuses(() => readScreen(null, { app: APP, translations: nb }), 'null');
  });

  test('BUG-70 and PRIV-07: no refusal repeats the output’s text, nor a number in it', async () => {
    const { readScreen } = await screenDump();
    const outputs = [
      `Uleselig skjerm ${MOBILE} ${FIRST.normalised}`,
      `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">Uleselig skjerm ${MOBILE} ${FIRST.normalised}</hierarchy>`,
    ];

    for (const output of outputs) {
      const message = refuses(
        () => readScreen(output, { app: APP, translations: nb }),
        'a refusal',
      );

      expect(message).not.toContain('Uleselig');
      expect(numberLeaks([message]), message).toEqual([]);
    }
  });
});

describe('BUG-70 and PRIV-07: readScreen prints no number and no name from the screen', () => {
  test('BUG-70 and PRIV-07 (the check the test below uses): a number is caught whole, in groups, spelled digit by digit, or by six of its digits', () => {
    const grouped = `${MOBILE.slice(0, 3)} ${MOBILE.slice(3, 5)} ${MOBILE.slice(5)}`;

    expect(numberLeaks([`x ${MOBILE}`])).toHaveLength(1);
    expect(numberLeaks([`x ${grouped}`])).toHaveLength(1);
    expect(numberLeaks([`x …${MOBILE.slice(-6)}`])).toHaveLength(1);
    expect(numberLeaks([`x ${FIRST.normalised}`])).toHaveLength(1);
    expect(numberLeaks([`x ${FIRST.typed}`])).toHaveLength(1);
    expect(numberLeaks([`x ${spelled(FIRST.normalised)}`])).toHaveLength(1);
    expect(numberLeaks([`${APP}: id none; text: other text (13 characters); label: none`])).toEqual(
      [],
    );
  });

  test('BUG-70 and PRIV-07: with #1’s number in a text and spelled in a label, in the message of a call that could not start, a member’s synthetic name typed and in a dialog, and another number in System UI, no line holds a number, six of its digits, or the name', async () => {
    const { readScreen } = await screenDump();
    const member = syntheticDisplayName();
    const xml = hierarchyDump(APP, [
      appWindowNode([
        emergencyBar(),
        textNode(filled(nb.grp.firstContact.shown, FIRST.name)),
        textNode(FIRST.normalised, spelled(FIRST.normalised)),
        buttonNode({
          id: CALL_ID,
          label: filled(nb.call.button.call, FIRST.name),
          texts: [filled(nb.call.button.call, FIRST.name)],
        }),
        textNode(
          filled(nb.call.button.failed, FIRST.normalised),
          filled(nb.call.button.failed, spelled(FIRST.normalised)),
        ),
        editTextNode(nb.grp.firstContact.numberLabel, FIRST.typed),
        editTextNode(nb.grp.join.nameLabel, member),
        textNode(filled(nb.grp.members.confirmText, member)),
        buttonNode({
          label: filled(nb.grp.members.confirm, member),
          texts: [filled(nb.grp.members.confirm, member)],
        }),
      ]),
      {
        package: 'com.android.systemui',
        resourceId: 'com.android.systemui:id/notification_stack_scroller',
        children: [
          {
            className: 'android.widget.TextView',
            resourceId: 'android:id/title',
            text: 'Tapt anrop',
          },
          { className: 'android.widget.TextView', resourceId: 'android:id/text', text: MOBILE },
          {
            className: 'android.widget.TextView',
            text: `Fra ${MOBILE}`,
            contentDesc: spelled(MOBILE),
          },
        ],
      },
    ]);

    const lines = readScreen(xml, { app: APP, translations: nb });
    const printed = lines.join('\n');

    // Not vacuous: the dump held both numbers, whole and spelled, and the name.
    expect(xml).toContain(FIRST.normalised);
    expect(xml).toContain(spelled(FIRST.normalised));
    expect(xml).toContain(MOBILE);
    expect(xml).toContain(member);
    // And the screen was read: its keys are named.
    expect(lines).toContain(
      `${APP}: id trygghverdag-call-button; text: none; label: call.button.call`,
    );
    expect(lines).toContain(`${APP}: id none; text: call.button.failed; label: call.button.failed`);
    expect(lines).toContain('com.android.systemui: id android:id/text');
    expect(numberLeaks(lines), printed).toEqual([]);
    expect(printed).not.toContain(member);
    expect(printed).not.toContain(FIRST.name);
    // No digit run of three or more at all: every count here is under 100,
    // and no ID or package here holds a digit, so any such run came from a
    // text or a label ("112" included).
    expect(printed).not.toMatch(/\d{3,}/);
  });
});
