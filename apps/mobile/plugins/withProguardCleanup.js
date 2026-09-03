/**
 * Expo config plugin: remove dead/overbroad R8 keep rules from the generated
 * android/app/proguard-rules.pro.
 *
 * The default React Native template ships proguard-rules.pro with:
 *   -keep class com.swmansion.reanimated.** { *; }
 *   -keep class com.facebook.react.turbomodule.** { *; }
 *
 * `react-native-reanimated` is not a dependency of this app, so the first
 * rule keeps nothing and is dead template leftover. The second is a
 * package-wide wildcard keep of React Native's own TurboModule runtime; RN
 * core already ships its own consumer ProGuard rules for this, so a blanket
 * project-level keep is redundant and would block R8 from stripping unused
 * TurboModule classes once minification is enabled for release builds.
 *
 * See: r8-analyzer audit, issue #380.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RULES_TO_REMOVE = [
  '# react-native-reanimated',
  '-keep class com.swmansion.reanimated.** { *; }',
  '-keep class com.facebook.react.turbomodule.** { *; }',
];

/** @param {import('@expo/config-plugins').ExpoConfig} config */
function withProguardCleanup(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      if (!fs.existsSync(proguardPath)) {
        return config;
      }

      const contents = fs.readFileSync(proguardPath, 'utf8');
      const filtered = contents
        .split('\n')
        .filter((line) => !RULES_TO_REMOVE.includes(line.trim()))
        .join('\n')
        // Collapse the blank line(s) left behind by removed rules.
        .replace(/\n{3,}/g, '\n\n');

      fs.writeFileSync(proguardPath, filtered);

      return config;
    },
  ]);
}

module.exports = withProguardCleanup;
