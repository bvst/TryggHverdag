import { HomeScreen } from '../features/grp';
import { Screen } from '../shared/ui';

/**
 * The index route: the screen the app opens on (GRP-01, GRP-02). The join
 * screen for a phone not signed in to the group, the home screen for one
 * that is, with #1, the call button and 112 (CALL-01, CALL-02). This route
 * draws `Screen`, and with it the 112 bar, around whatever the feature
 * renders here, so every view inside it has 112 (CALL-02-AC1). Nothing on it
 * suggests anyone is being looked after: no journey exists in the app yet,
 * and reassurance the app cannot back up is worse than none.
 */
export default function Index() {
  return (
    <Screen>
      <HomeScreen />
    </Screen>
  );
}
