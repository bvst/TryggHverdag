import { HomeScreen } from '../features/grp';

/**
 * The index route: the screen the app opens on (GRP-01). The join screen for
 * a phone not signed in to the group, the member screen for one that is.
 * Nothing on it suggests anyone is being looked after: no journey exists in
 * the app yet, and reassurance the app cannot back up is worse than none.
 */
export default function Index() {
  return <HomeScreen />;
}
