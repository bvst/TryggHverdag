// SPIKE-01: the app's entry. The headless task is registered here, outside any
// component, so the SDK can hand it events after the app is swiped away.
import { registerRootComponent } from 'expo';
import BackgroundGeolocation from 'react-native-background-geolocation';

import App from './src/App';
import { headlessTask } from './src/journey';

BackgroundGeolocation.registerHeadlessTask(headlessTask);
registerRootComponent(App);
