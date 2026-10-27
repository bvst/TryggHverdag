/**
 * The screen a failed L7 flow left, named for the job log by
 * scripts/e2e-android.mjs (BUG-70), because Maestro's debug output cannot be
 * read from a session and nothing else says which screen the app showed. Pure:
 * the reader takes the file `adb shell uiautomator dump` wrote, as cat printed
 * it, and reads its <node> attributes itself.
 *
 * PRIV-07: a screen may show a name or a number, so a text or a label is never
 * printed, only the translation keys whose value it is, or its length; and
 * resource-ids and package names, which are code identifiers. Output that is
 * not a hierarchy is refused with an error, never read as an empty screen, and
 * no message repeats its text.
 */

/** The node lines printed, at most; the rest are counted. */
const MAX_NODE_LINES = 40;

/** An i18next placeholder, `{{name}}`: one character or more of the text. */
const PLACEHOLDER = /\{\{[^{}]+\}\}/;

/** A <node …> tag, its attributes in group 1; a quoted value may hold a `>`. */
const NODE_TAG = /<node\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** One attribute: its name, and its value in double or single quotes. */
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** XML's predefined entities, and a character by its number, decimal or hex. */
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\dA-Fa-f]+));/g;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `value` with its entities decoded, in one pass, so each is decoded once. */
function decoded(value) {
  return value.replace(ENTITY, (entity, name, decimal, hex) => {
    if (name !== undefined) return NAMED_ENTITIES[name];
    const code = decimal === undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal, 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** A <node> tag's attributes, by name, as written. */
function attributesOf(tag) {
  const attributes = new Map();
  for (const [, name = '', double, single] of tag.matchAll(ATTRIBUTE)) {
    attributes.set(name, double ?? single ?? '');
  }
  return attributes;
}

/** `text` with the characters a pattern reads apart escaped. */
const escaped = (text) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/**
 * Every key in `translations` with a text value, in its order, dotted
 * (`grp.join.title`): its value, and, when the value has a placeholder, the
 * pattern the whole of a text must match.
 */
function keysOf(translations, prefix = '') {
  return Object.entries(translations).flatMap(([name, value]) => {
    const key = `${prefix}${name}`;
    if (value !== null && typeof value === 'object') return keysOf(value, `${key}.`);
    if (typeof value !== 'string') return [];
    const parts = value.split(PLACEHOLDER);
    const pattern =
      parts.length === 1 ? null : new RegExp(`^${parts.map(escaped).join('.+')}$`, 's');
    return [{ key, value, pattern }];
  });
}

/**
 * What a text or a label is, never the text itself: `none`; the keys whose
 * value it equals with no placeholder, when there are any (an exact match
 * wins); else the keys whose value matches it through a placeholder; else its
 * length.
 */
function nameOf(text, keys) {
  if (text === '') return 'none';
  const exact = keys.filter(({ value, pattern }) => pattern === null && value === text);
  const named = exact.length > 0 ? exact : keys.filter(({ pattern }) => pattern?.test(text));
  if (named.length === 0) return `other text (${String(text.length)} characters)`;
  return named.map(({ key }) => key).join(' or ');
}

/**
 * The lines that name the screen in `xml`, uiautomator's dump: one per node
 * with a resource-id, a text or a label (content-desc), in the dump's order.
 * The app's nodes by id, and their text and label by translation keys; other
 * packages' by id only. When none of the app's nodes has one, a line says so,
 * first. At most MAX_NODE_LINES node lines, then how many more there were.
 *
 * @param {unknown} xml
 * @param {{ app: string, translations: Record<string, unknown> }} options
 *   `app` is the app's Android application ID; `translations` is nb.json, parsed
 * @returns {string[]}
 */
export function readScreen(xml, { app, translations }) {
  if (typeof xml !== 'string')
    throw new Error('the screen dump must be the text uiautomator wrote.');
  if (!/<hierarchy\b/.test(xml)) {
    throw new Error('the output has no <hierarchy> root, so it is not a uiautomator dump');
  }
  const nodes = Array.from(xml.matchAll(NODE_TAG), ([, tag = '']) => attributesOf(tag));
  if (nodes.length === 0) {
    throw new Error('the hierarchy has no <node> in it, so it names no screen');
  }
  const keys = keysOf(translations);
  const named = nodes.flatMap((node) => {
    const id = node.get('resource-id') ?? '';
    const text = decoded(node.get('text') ?? '');
    const label = decoded(node.get('content-desc') ?? '');
    if (id === '' && text === '' && label === '') return [];
    const pack = node.get('package') ?? '';
    const head = `${pack}: id ${id === '' ? 'none' : id}`;
    if (pack !== app) return [{ ofApp: false, line: head }];
    return [
      { ofApp: true, line: `${head}; text: ${nameOf(text, keys)}; label: ${nameOf(label, keys)}` },
    ];
  });
  const blank = named.some(({ ofApp }) => ofApp)
    ? []
    : [`${app}: no node with an id, text or label`];
  const more =
    named.length > MAX_NODE_LINES
      ? [`and ${String(named.length - MAX_NODE_LINES)} more nodes, not shown`]
      : [];
  return [...blank, ...named.slice(0, MAX_NODE_LINES).map(({ line }) => line), ...more];
}
