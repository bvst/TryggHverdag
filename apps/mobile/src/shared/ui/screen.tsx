/**
 * A screen: the 112 bar at the top, and below it what the screen shows,
 * scrollable when the keyboard is up or the text is large (CALL-02, approach
 * 1). Every route under src/app/ draws one around what it renders, and the
 * features never do (CALL-02-AC1), so every screen the app shows has 112.
 *
 * Its shape is what keeps 112 uncovered (CALL-02-AC2): inside the safe area,
 * the bar and one clipping container are siblings, the bar first. Every
 * child is drawn inside the container, a ScrollView, which clips what it
 * holds, so a child positioned absolutely, at any size or zIndex, is clipped
 * to the area below the bar and cannot cover it. The bar is never inside it,
 * so no scroll moves it, and it has no prop that removes it.
 *
 * A route that draws several views inside it starts each new one at the
 * top of the ScrollView, with focus on its heading, through the context
 * `Screen` provides around what it holds (new-view.tsx, GRP-02-AC11). It
 * draws no element of its own, so the shape above is unchanged.
 *
 * On a dark background from the palette (Q5, D-141). Expo Router provides the
 * SafeAreaProvider this reads.
 */
import { useCallback, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmergencyBar } from '../../features/call';
import { ScreenViews } from './new-view';
import { palette } from './palette';

export function Screen({ children }: { children?: ReactNode }) {
  const scroll = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <EmergencyBar />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenViews scrollToTop={scrollToTop}>{children}</ScreenViews>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.background,
  },
  scroll: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 16,
  },
});
