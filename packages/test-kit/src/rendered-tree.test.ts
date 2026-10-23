// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The app's L5 tests read sizes, labels and what holds what from the rendered
// tree with these. A reader that merged styles in the wrong order, missed a
// shorthand, read a nested Text twice, or found a component where there is
// none would make the size and "nothing covers 112" tests pass, or fail,
// whatever the app drew.
import { describe, expect, test } from 'vitest';
import {
  ancestorsOf,
  componentName,
  fiberWithin,
  fibersUnder,
  flattenStyle,
  hintOf,
  holds,
  isPressable,
  labelOf,
  marginOn,
  nameOf,
  paddingOn,
  rendersComponent,
  rootFiberOf,
  roleOf,
  sameFiber,
  shownTexts,
  spelled,
  styleOf,
  textOf,
  type FiberLike,
  type HostNode,
} from './rendered-tree.ts';

/** A host element, with its children's parents set to it. */
function host(
  type: string,
  props: Record<string, unknown> = {},
  children: (HostNode | string)[] = [],
): HostNode {
  const node = { type, props, parent: null as HostNode | null, children };
  for (const child of children) {
    if (typeof child !== 'string') {
      (child as { parent: HostNode | null }).parent = node;
    }
  }
  return node;
}

describe('rendered-tree', () => {
  test('reads text, nested Text once, in order, and says what holds what', () => {
    const inner = host('Text', {}, ['b']);
    const outer = host('Text', {}, ['a', inner]);
    const button = host('View', { accessibilityLabel: 'Ring', onClick: () => undefined }, [
      host('Text', {}, ['c']),
    ]);
    const root = host('View', {}, [outer, button]);
    const all = [root, outer, inner, button, button.children[0] as HostNode];

    expect(textOf(root)).toBe('abc');
    expect(shownTexts(all).map(({ text }) => text)).toEqual(['ab', 'c']);
    expect(holds(root, inner)).toBe(true);
    expect(holds(inner, root)).toBe(false);
    expect(ancestorsOf(inner)).toEqual([outer, root]);
    expect(labelOf(button)).toBe('Ring');
    expect(nameOf(button)).toBe('Ring');
    expect(nameOf(outer)).toBe('ab');
    expect(isPressable(button)).toBe(true);
    expect(isPressable(host('TextInput', { onPress: () => undefined }))).toBe(false);
  });

  test('reads a hint and a role by either prop, and no label from an empty one', () => {
    expect(hintOf(host('View', { accessibilityHint: 'Ringer' }))).toBe('Ringer');
    expect(roleOf(host('View', { role: 'button' }))).toBe('button');
    expect(roleOf(host('View', { accessibilityRole: 'button' }))).toBe('button');
    expect(labelOf(host('View', { accessibilityLabel: '  ' }))).toBeNull();
    expect(labelOf(host('View', { 'aria-label': 'x' }))).toBe('x');
  });

  test('flattens a style as React Native does: arrays merged left to right, the later winning, falsy parts skipped', () => {
    expect(
      flattenStyle([{ minHeight: 56, padding: 4 }, null, false, [{ minHeight: 120 }, undefined]]),
    ).toEqual({ minHeight: 120, padding: 4 });
    expect(styleOf(host('View', { style: { a: 1 } }))).toEqual({ a: 1 });
    expect(flattenStyle(undefined)).toEqual({});
  });

  test('resolves padding and margin on one side through the shorthands, the side first', () => {
    expect(paddingOn({ padding: 8 }, 'Bottom')).toBe(8);
    expect(paddingOn({ padding: 8, paddingVertical: 12 }, 'Bottom')).toBe(12);
    expect(paddingOn({ padding: 8, paddingVertical: 12, paddingBottom: 30 }, 'Bottom')).toBe(30);
    expect(paddingOn({ paddingTop: 5 }, 'Bottom')).toBe(0);
    expect(marginOn({ margin: 3, marginTop: 9 }, 'Top')).toBe(9);
    expect(marginOn({ margin: '10%' }, 'Top')).toBe(0);
  });

  test('spells a number for a screen reader, each character apart', () => {
    expect(spelled('+123')).toBe('+ 1 2 3');
    expect(spelled('')).toBe('');
  });

  test('finds a component among fibers by its type, through memo too, and says what lies within what', () => {
    function Screen(): null {
      return null;
    }
    function Other(): null {
      return null;
    }
    const fiber = (type: unknown, parent: FiberLike | null): FiberLike => ({
      type,
      elementType: type,
      memoizedProps: {},
      return: parent,
      child: null,
      sibling: null,
    });
    const root = fiber(null, null);
    const screen = fiber(Screen, root);
    const memo = fiber({ $$typeof: 'memo', type: Screen }, root);
    const leaf = fiber('View', screen);
    Object.assign(root, { child: screen });
    Object.assign(screen, { child: leaf, sibling: memo });

    expect(rootFiberOf(leaf)).toBe(root);
    expect(fibersUnder(root)).toEqual([root, screen, leaf, memo]);
    expect(fibersUnder(root).filter((each) => rendersComponent(each, Screen))).toEqual([
      screen,
      memo,
    ]);
    expect(rendersComponent(screen, Other)).toBe(false);
    expect(fiberWithin(leaf, screen)).toBe(true);
    expect(fiberWithin(memo, screen)).toBe(false);
    expect(componentName(Screen)).toBe('Screen');
    expect(componentName('View')).toBe('View');
    expect(componentName({ displayName: 'Named' })).toBe('Named');
  });

  test('counts a fiber and its alternate, React’s other copy of it, as one', () => {
    const root: FiberLike = {
      type: null,
      elementType: null,
      memoizedProps: {},
      return: null,
      child: null,
      sibling: null,
    };
    const current: FiberLike = { ...root, type: 'View', return: root };
    const alternate: FiberLike = { ...current, alternate: current };
    const leaf: FiberLike = { ...root, type: 'Text', return: alternate };

    expect(sameFiber(current, alternate)).toBe(true);
    expect(sameFiber(alternate, current)).toBe(true);
    expect(sameFiber(current, root)).toBe(false);
    expect(fiberWithin(leaf, current)).toBe(true);
    expect(fiberWithin(root, current)).toBe(false);
  });
});
