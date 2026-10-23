/**
 * A new view inside one `Screen` starts at its top, with screen-reader focus
 * on its heading (GRP-02-AC11; CALL-02, approach 1).
 *
 * One route can draw several views inside one `Screen`, and so inside one
 * ScrollView: the index route draws the home screen, #1's setup, the
 * invitation and the member list. Without this, a view opened from a screen
 * scrolled down at a large font opens scrolled down too, its heading out of
 * sight, and a screen reader stays where the old view's button was.
 *
 * `Screen` owns the ScrollView, so it provides the way, through this context:
 *   - `Heading` says where it is drawn, and when it is gone;
 *   - a feature that changes view calls `useViewStartsAtTop` with the view it
 *     shows. When that changes, `Screen`'s ScrollView goes to its top and
 *     focus moves to the heading the new view draws. The first view a route
 *     shows moves nothing: the screen starts at its top already, and a heading
 *     that appears when the server answers does not take the focus from where
 *     the walker is.
 * Outside a `Screen`, both do nothing.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { AccessibilityInfo, type Text } from 'react-native';

/** A heading's element, once it is drawn. */
export type HeadingRef = RefObject<ComponentRef<typeof Text> | null>;

interface ScreenViews {
  /** A heading is drawn inside the Screen; the function it returns says it is gone. */
  addHeading: (heading: HeadingRef) => () => void;
  /** A new view is drawn: the scroll to its top, and focus to its heading. */
  opened: () => void;
}

const ScreenViewsContext = createContext<ScreenViews | null>(null);

/** Drawn by `Screen` around what it holds, with the way to scroll its ScrollView to the top. */
export function ScreenViews({
  scrollToTop,
  children,
}: {
  scrollToTop: () => void;
  children?: ReactNode;
}) {
  /** The headings drawn now, in the order they were drawn. */
  const headings = useRef(new Set<HeadingRef>());
  const views = useMemo<ScreenViews>(
    () => ({
      addHeading: (heading) => {
        headings.current.add(heading);
        return () => {
          headings.current.delete(heading);
        };
      },
      opened: () => {
        scrollToTop();
        for (const heading of headings.current) {
          if (heading.current !== null) {
            AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
            return;
          }
        }
      },
    }),
    [scrollToTop],
  );

  return <ScreenViewsContext.Provider value={views}>{children}</ScreenViewsContext.Provider>;
}

/** For `Heading`: says where it is drawn, so a new view's focus can go to it. */
export function useScreenHeading(heading: HeadingRef): void {
  const views = useContext(ScreenViewsContext);

  useEffect(() => views?.addHeading(heading), [views, heading]);
}

/**
 * For a feature that draws several views inside one route: each time `view`
 * changes, the new view starts at the top of the Screen, with focus on its
 * heading. Its effect runs after those of the view it draws, so the new
 * view's heading has said where it is by then.
 */
export function useViewStartsAtTop(view: string): void {
  const views = useContext(ScreenViewsContext);
  const shown = useRef(view);

  useEffect(() => {
    if (shown.current === view) {
      return;
    }
    shown.current = view;
    views?.opened();
  }, [view, views]);
}
