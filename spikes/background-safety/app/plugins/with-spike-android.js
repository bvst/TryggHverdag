// SPIKE-01: a local config plugin, so both settings survive
// `expo prebuild --clean` without a hand edit of android/. Spike-only: never
// copy into the product.
//
// 1. Debug builds carry their JavaScript. React Native skips bundling for the
//    variants in `debuggableVariants` (by default the debug ones); an empty list
//    bundles every variant, so a 45-minute run never depends on Metro.
// 2. Cleartext HTTP to 10.0.2.2 (the emulator's name for the Mac's loopback)
//    and nowhere else. A network security config allows that one address, and
//    the template's debug manifests, which allow cleartext everywhere, are
//    turned off too.
//
// Each edit throws if the template no longer looks as expected: a setting that
// silently failed to apply would make the run measure something else.
const fs = require('node:fs');
const path = require('node:path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require('expo/config-plugins');

const MARK = '// SPIKE-01: bundle JavaScript in every variant';
const NETWORK_CONFIG = 'network_security_config';
const DEBUG_MANIFESTS = ['debug', 'debugOptimized'];

const NETWORK_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- SPIKE-01 only: cleartext HTTP to the emulator's name for the Mac's loopback, nowhere else. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`;

function withBundledDebugJs(config) {
  return withAppBuildGradle(config, (gradle) => {
    const { contents } = gradle.modResults;
    if (contents.includes(MARK)) return gradle;
    if (!/^react \{$/m.test(contents)) {
      throw new Error('SPIKE-01 plugin: no "react {" block in android/app/build.gradle');
    }
    gradle.modResults.contents = contents.replace(
      /^react \{$/m,
      `react {\n    ${MARK}\n    debuggableVariants = []`,
    );
    return gradle;
  });
}

function withLoopbackCleartextOnly(config) {
  config = withAndroidManifest(config, (manifest) => {
    const application = manifest.modResults.manifest.application?.[0];
    if (!application) throw new Error('SPIKE-01 plugin: the manifest has no <application>');
    application.$['android:networkSecurityConfig'] = `@xml/${NETWORK_CONFIG}`;
    return manifest;
  });
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const src = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src');
      const xmlDir = path.join(src, 'main', 'res', 'xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, `${NETWORK_CONFIG}.xml`), NETWORK_XML);
      for (const variant of DEBUG_MANIFESTS) {
        const file = path.join(src, variant, 'AndroidManifest.xml');
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        const off = text.replace(
          'android:usesCleartextTraffic="true"',
          'android:usesCleartextTraffic="false"',
        );
        if (off === text && !text.includes('android:usesCleartextTraffic="false"')) {
          throw new Error(`SPIKE-01 plugin: the ${variant} manifest's cleartext setting has moved`);
        }
        fs.writeFileSync(file, off);
      }
      return modConfig;
    },
  ]);
}

module.exports = (config) => withLoopbackCleartextOnly(withBundledDebugJs(config));
