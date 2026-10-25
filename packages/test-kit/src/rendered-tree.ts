/**
 * Reading the app's rendered tree as a person and a screen reader meet it
 * (GRP-01, GRP-02, CALL-01, CALL-02; M3 task 2).
 *
 * The app's L5 tests render it through Expo Router's testing library, whose
 * renderer hands out host elements: a type such as 'View', 'Text' or
 * 'RCTScrollView', its props, its parent and its children. These read that
 * tree by shape (`HostNode`), so the test kit needs no React Native:
 *   - the text a person reads, in order, and an element's screen-reader label,
 *     hint and role;
 *   - an element's style as React Native draws it, flattened from the arrays
 *     and nesting a component may pass (`flattenStyle`), and the lengths of
 *     padding and margin on one side, shorthands included;
 *   - which elements can be pressed;
 *   - the components behind a host element, by the renderer's fiber, which
 *     carries each component's type: so a test can find a component by its
 *     type (CALL-02-AC1: exactly one `Screen`) and ask what holds what.
 * A number is spelled for a screen reader by `spelled`: its characters
 * separated by single spaces (GRP-02-AC10, CALL-01-AC8).
 */

/** A rendered host element, as the renderer hands one out. */
export interface HostNode {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly parent: HostNode | null;
  readonly children: readonly (HostNode | string)[];
}

/** A style, flattened: every property React Native would draw with. */
export type FlatStyle = Readonly<Record<string, unknown>>;

/** The text an element holds, its children's included. */
export function textOf(node: HostNode): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

/** Whether an element sits inside a Text, which lays it out as part of its own lines. */
export function insideText(node: HostNode): boolean {
  for (let up = node.parent; up !== null; up = up.parent) {
    if (up.type === 'Text') {
      return true;
    }
  }
  return false;
}

/** Every element above `node`, nearest first. */
export function ancestorsOf(node: HostNode): HostNode[] {
  const above: HostNode[] = [];
  for (let up = node.parent; up !== null; up = up.parent) {
    above.push(up);
  }
  return above;
}

/** Whether `ancestor` holds `node`, at any depth. */
export function holds(ancestor: HostNode, node: HostNode): boolean {
  return ancestorsOf(node).includes(ancestor);
}

/** Every Text among `nodes` that sits inside no other Text: what a person reads, in order. */
export function shownTexts(nodes: readonly HostNode[]): { node: HostNode; text: string }[] {
  return nodes
    .filter((node) => node.type === 'Text' && !insideText(node))
    .map((node) => ({ node, text: textOf(node) }));
}

/** A string prop, when it holds something visible. */
function stringProp(node: HostNode, ...names: string[]): string | null {
  for (const name of names) {
    const value = node.props[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return null;
}

/** An element's screen-reader label, if it has one. */
export function labelOf(node: HostNode): string | null {
  return stringProp(node, 'accessibilityLabel', 'aria-label');
}

/** An element's screen-reader hint, if it has one. */
export function hintOf(node: HostNode): string | null {
  return stringProp(node, 'accessibilityHint');
}

/** An element's role, by either of React Native's two props for it. */
export function roleOf(node: HostNode): unknown {
  return node.props['accessibilityRole'] ?? node.props['role'];
}

/** What a screen reader calls an element: its label, or else the text it holds. */
export function nameOf(node: HostNode): string {
  return labelOf(node) ?? textOf(node);
}

/** Whether an element can be pressed: it answers a press, and is not a text field. */
export function isPressable(node: HostNode): boolean {
  return (
    node.type !== 'TextInput' &&
    (typeof node.props['onClick'] === 'function' || typeof node.props['onPress'] === 'function')
  );
}

/** Whether a value is a plain object, not an array and not null. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A style as React Native draws it: arrays and nested arrays merged left to
 * right, the later winning, and `false`, `null` and `undefined` skipped, as
 * `StyleSheet.flatten` does with what `StyleSheet.create` makes.
 */
export function flattenStyle(style: unknown): FlatStyle {
  if (Array.isArray(style)) {
    return style.reduce<FlatStyle>((flat, part) => ({ ...flat, ...flattenStyle(part) }), {});
  }
  return isRecord(style) ? { ...style } : {};
}

/** An element's own style, flattened. */
export function styleOf(node: HostNode): FlatStyle {
  return flattenStyle(node.props['style']);
}

/** A length in a style, when it is a number; 0 otherwise (unset, or a percentage). */
function lengthIn(style: FlatStyle, ...names: string[]): number {
  for (const name of names) {
    const value = style[name];
    if (typeof value === 'number') {
      return value;
    }
  }
  return 0;
}

/** The padding on one side, as React Native resolves its shorthands: the side, then the axis, then all. */
export function paddingOn(style: FlatStyle, side: 'Top' | 'Bottom'): number {
  return lengthIn(style, `padding${side}`, 'paddingVertical', 'padding');
}

/** The margin on one side, as React Native resolves its shorthands. */
export function marginOn(style: FlatStyle, side: 'Top' | 'Bottom'): number {
  return lengthIn(style, `margin${side}`, 'marginVertical', 'margin');
}

/** A number as a screen reader should read it: each character apart, `+123` as `+ 1 2 3`. */
export function spelled(number: string): string {
  return Array.from(number).join(' ');
}

/**
 * A React fiber, by the shape these read: the component's type and the
 * fiber's place in the tree. The renderer hands one out for each host
 * element (`unstable_fiber`).
 */
export interface FiberLike {
  readonly type: unknown;
  readonly elementType: unknown;
  readonly memoizedProps: unknown;
  readonly return: FiberLike | null;
  readonly child: FiberLike | null;
  readonly sibling: FiberLike | null;
  /** The same component's fiber in React's other tree, when it has one (React keeps two). */
  readonly alternate?: FiberLike | null;
}

/** Whether two fibers are one component's: the same fiber, or each other's alternate. */
export function sameFiber(a: FiberLike, b: FiberLike): boolean {
  return a === b || (a.alternate ?? null) === b || (b.alternate ?? null) === a;
}

/** The fiber at the top of the tree `fiber` is in. */
export function rootFiberOf(fiber: FiberLike): FiberLike {
  let top = fiber;
  while (top.return !== null) {
    top = top.return;
  }
  return top;
}

/** Every fiber under `root`, `root` included, in the order React renders them. */
export function fibersUnder(root: FiberLike): FiberLike[] {
  const found: FiberLike[] = [];
  const visit = (fiber: FiberLike | null): void => {
    for (let at = fiber; at !== null; at = at.sibling) {
      found.push(at);
      visit(at.child);
    }
  };
  found.push(root);
  visit(root.child);
  return found;
}

/** Whether a fiber renders `component`, directly or through memo or forwardRef. */
export function rendersComponent(fiber: FiberLike, component: unknown): boolean {
  if (fiber.type === component || fiber.elementType === component) {
    return true;
  }
  const inner = (value: unknown): unknown =>
    typeof value === 'object' && value !== null
      ? ((value as { type?: unknown; render?: unknown }).type ??
        (value as { render?: unknown }).render)
      : undefined;
  return inner(fiber.type) === component || inner(fiber.elementType) === component;
}

/** Whether `fiber` is `ancestor` or lies under it, either of React's two trees counted as one. */
export function fiberWithin(fiber: FiberLike, ancestor: FiberLike): boolean {
  for (let at: FiberLike | null = fiber; at !== null; at = at.return) {
    if (sameFiber(at, ancestor)) {
      return true;
    }
  }
  return false;
}

/** A component's name, as React reports it: its displayName, or its function's name. */
export function componentName(type: unknown): string {
  if (typeof type === 'string') {
    return type;
  }
  if (typeof type === 'function' || (typeof type === 'object' && type !== null)) {
    const named = type as { displayName?: unknown; name?: unknown; render?: unknown };
    if (typeof named.displayName === 'string' && named.displayName !== '') {
      return named.displayName;
    }
    if (typeof named.name === 'string' && named.name !== '') {
      return named.name;
    }
    if (named.render !== undefined) {
      return componentName(named.render);
    }
  }
  return '';
}
