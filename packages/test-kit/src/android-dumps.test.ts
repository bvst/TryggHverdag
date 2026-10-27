// req-coverage: fixtures-only — the builders of the emulator's dumps, not a requirement's proof.
import { describe, expect, test } from 'vitest';
import {
  DIALER_PACKAGE,
  WAKEFULNESS,
  appWindow,
  appWindowNode,
  buttonNode,
  callRecord,
  dialerWindow,
  dialingEvents,
  dialledEvents,
  editTextNode,
  endingEvents,
  hierarchyDump,
  layoutNode,
  maskedAddress,
  powerDump,
  progressNode,
  roleHoldersOutput,
  telecomDump,
  textNode,
  windowDump,
} from './android-dumps.ts';

const NUMBER = '+447700900318';

describe('the emulator’s dumps, as the L7 script reads them', () => {
  test('a masked address keeps the number’s length and only its last two characters', () => {
    const masked = maskedAddress(NUMBER);

    expect(masked).toBe(`tel:${'*'.repeat(NUMBER.length - 2)}18`);
    expect(masked.slice(4)).toHaveLength(NUMBER.length);
    expect(masked).not.toContain(NUMBER.slice(0, -2));
  });

  test('Telecom’s dump ends its head with "Historical Events:", and holds each call’s record after it, in order', () => {
    const address = maskedAddress(NUMBER);
    const first = callRecord({ id: 1, address, events: dialledEvents('a.b', address) });
    const second = callRecord({ id: 2, address, events: dialledEvents('c.d', address) });
    const lines = telecomDump([first, second]).split('\n');
    const heading = lines.indexOf('Historical Events:');

    expect(heading).toBeGreaterThan(0);
    expect(lines.slice(heading + 1, heading + 1 + first.length)).toEqual(first);
    expect(lines.join('\n')).toContain('CREATED (c.d;');
    expect(lines.findIndex((line) => line.includes('CallTC@2/'))).toBeGreaterThan(
      lines.findIndex((line) => line.includes('CallTC@1/')),
    );
    expect(telecomDump([])).toMatch(/Historical Events:\n$/);
  });

  test('the window dump names the focused window; the role output names one package per line', () => {
    expect(windowDump(appWindow('a.b'))).toContain(
      'mCurrentFocus=Window{9c8b7a6 u0 a.b/a.b.MainActivity}',
    );
    expect(windowDump(dialerWindow())).toContain(
      `mCurrentFocus=Window{4f3b2a1 u0 ${DIALER_PACKAGE}/`,
    );
    expect(roleHoldersOutput([DIALER_PACKAGE])).toBe(`${DIALER_PACKAGE}\n`);
    expect(roleHoldersOutput([])).toBe('');
  });

  test('a call in progress has its events up to SET_DIALING and none that end it; an ended call adds SET_DISCONNECTED, LOG_CALL and DESTROYED, in that order', () => {
    const address = maskedAddress(NUMBER);
    const name = (event: string) => /^\S+ - ([A-Z_]+)/.exec(event)?.[1];

    expect(dialingEvents('a.b', address).map(name)).toEqual([
      'CREATED',
      'SET_CONNECTING',
      'START_CONNECTION',
      'SET_DIALING',
    ]);
    expect(endingEvents(address).map(name)).toEqual(['SET_DISCONNECTED', 'LOG_CALL', 'DESTROYED']);
    expect(dialledEvents('a.b', address)).toEqual([
      ...dialingEvents('a.b', address),
      ...endingEvents(address),
    ]);
  });

  test('the power dump holds one mWakefulness= line with the value given, beside mWakefulnessChanging=; given null, no mWakefulness= line', () => {
    for (const value of WAKEFULNESS) {
      const lines = powerDump(value).split('\n');
      expect(lines.filter((line) => /^\s*mWakefulness=/.test(line))).toEqual([
        `  mWakefulness=${value}`,
      ]);
      expect(lines).toContain('  mWakefulnessChanging=false');
    }
    const without = powerDump(null).split('\n');
    expect(without.filter((line) => /^\s*mWakefulness=/.test(line))).toEqual([]);
    expect(without).toContain('  mWakefulnessChanging=false');
  });
});

// BUG-70: the screen as `uiautomator dump` writes it.
describe('the screen dump, as uiautomator writes it (BUG-70)', () => {
  /** Each <node …> opening in the dump, in order: its attributes, by name, in the order written. */
  const nodesOf = (xml: string): Map<string, string>[] =>
    [...xml.matchAll(/<node ((?:[a-z-]+="[^"]*" ?)+)\/?>/g)].map(
      ([, attributes = '']) =>
        new Map(
          [...attributes.matchAll(/([a-z-]+)="([^"]*)"/g)].map(
            ([, name = '', value = '']): [string, string] => [name, value],
          ),
        ),
    );

  test('one line: the XML declaration, a hierarchy root, the phone upright, and the nodes in the tree’s order, a node with no children closed as " />"', () => {
    const xml = hierarchyDump('a.b', [
      layoutNode([textNode('first'), layoutNode([textNode('second')]), textNode('third')]),
    ]);

    expect(xml).not.toContain('\n');
    expect(xml.startsWith("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>")).toBe(true);
    expect(xml).toContain('<hierarchy rotation="0"><node index="0" text=""');
    expect(xml.endsWith('</node></hierarchy>')).toBe(true);
    expect(nodesOf(xml).map((node) => node.get('text'))).toEqual([
      '',
      'first',
      '',
      'second',
      'third',
    ]);
    expect(xml).toMatch(/text="first"[^>]*\/>/);
    expect(xml).toMatch(/ \/><\/node>/);
  });

  test('every node has the dumper’s attributes, in its order; a child’s index is its place among its siblings, and its package its parent’s unless it has its own', () => {
    const xml = hierarchyDump('a.b', [
      layoutNode([
        textNode('x'),
        { package: 'c.d', resourceId: 'c.d:id/e', children: [textNode('y')] },
      ]),
    ]);
    const nodes = nodesOf(xml);

    for (const node of nodes) {
      expect([...node.keys()]).toEqual([
        'index',
        'text',
        'resource-id',
        'class',
        'package',
        'content-desc',
        'checkable',
        'checked',
        'clickable',
        'enabled',
        'focusable',
        'focused',
        'scrollable',
        'long-clickable',
        'password',
        'selected',
        'bounds',
      ]);
    }
    expect(
      nodes.map((node) => [node.get('index'), node.get('package'), node.get('resource-id')]),
    ).toEqual([
      ['0', 'a.b', ''],
      ['0', 'a.b', ''],
      ['1', 'c.d', 'c.d:id/e'],
      ['0', 'c.d', ''],
    ]);
  });

  test('a text, a label and a resource-id are written with &, <, > and " as named entities and a line break or a tab by its number; nothing else is changed', () => {
    const xml = hierarchyDump('a.b', [
      textNode('Tom & "Jerry" <b>\n\t\r', "Ring 1 1 2, nødnummeret's"),
      { resourceId: 'a&b' },
    ]);

    expect(xml).toContain(
      'text="Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#10;&#9;&#13;" resource-id="" class="android.widget.TextView" package="a.b" content-desc="Ring 1 1 2, nødnummeret\'s"',
    );
    expect(xml).toContain('resource-id="a&amp;b"');
  });

  test('React Native’s views as the dump shows them: a button’s testID and label on a clickable Button with its texts below it, a ProgressBar’s and an EditText’s label as content-desc, and an app’s window with Android’s content frame', () => {
    const xml = hierarchyDump('a.b', [
      appWindowNode([
        buttonNode({ id: 'the-button', label: 'Label', texts: ['Title', 'Line'] }),
        progressNode('Waiting'),
        editTextNode('Field', 'typed'),
      ]),
    ]);
    const nodes = nodesOf(xml).map((node) =>
      ['class', 'resource-id', 'text', 'content-desc', 'clickable'].map((name) => node.get(name)),
    );

    expect(nodes).toEqual([
      ['android.widget.FrameLayout', '', '', '', 'false'],
      ['android.widget.LinearLayout', '', '', '', 'false'],
      ['android.widget.FrameLayout', 'android:id/content', '', '', 'false'],
      ['android.view.ViewGroup', '', '', '', 'false'],
      ['android.widget.Button', 'the-button', '', 'Label', 'true'],
      ['android.widget.TextView', '', 'Title', '', 'false'],
      ['android.widget.TextView', '', 'Line', '', 'false'],
      ['android.widget.ProgressBar', '', '', 'Waiting', 'false'],
      ['android.widget.EditText', '', 'typed', 'Field', 'true'],
    ]);
  });
});
