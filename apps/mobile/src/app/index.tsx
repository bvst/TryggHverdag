import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * The index route: the screen the app opens on.
 *
 * A placeholder while the app is built. It shows the working title and a line
 * saying the app cannot be used yet, and nothing that suggests anyone is
 * being looked after: reassurance the app cannot back up is worse than none.
 */
export default function Index() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('placeholder.title')}
      </Text>
      <Text style={styles.status}>{t('placeholder.status')}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  status: {
    fontSize: 17,
    textAlign: 'center',
  },
});
