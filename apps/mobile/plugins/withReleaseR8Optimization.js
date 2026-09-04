/**
 * Expo config plugin: enable R8 minification/shrinking for release builds
 * and use the optimized default ProGuard rule set.
 *
 * The React Native/Expo prebuild template generates release build types
 * with minification and resource shrinking gated behind gradle properties
 * that default to `false` when unset (`android.enableMinifyInReleaseBuilds`,
 * `android.enableShrinkResourcesInReleaseBuilds`). Left unset, R8 never runs
 * on release builds: no shrinking, no obfuscation, no optimization.
 *
 * This plugin:
 *   - Sets android.enableMinifyInReleaseBuilds=true
 *   - Sets android.enableShrinkResourcesInReleaseBuilds=true
 *   - Sets android.r8.optimizedResourceShrinking=true (AGP 8.6+ opt-in
 *     resource shrinker, on by default only starting AGP 9.0)
 *   - Switches app/build.gradle from the plain `proguard-android.txt`
 *     default to the optimized `proguard-android-optimize.txt` default
 *
 * See: r8-analyzer audit, issue #432.
 */
const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

const GRADLE_PROPERTIES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
  'android.r8.optimizedResourceShrinking': 'true',
};

/** @param {import('@expo/config-plugins').ExpoConfig} config */
function withReleaseR8Optimization(config) {
  config = withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      const existingIndex = config.modResults.findIndex(
        (item) => item.type === 'property' && item.key === key
      );

      if (existingIndex >= 0) {
        config.modResults[existingIndex].value = value;
      } else {
        config.modResults.push({ type: 'property', key, value });
      }
    }

    return config;
  });

  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      /getDefaultProguardFile\("proguard-android\.txt"\)/,
      'getDefaultProguardFile("proguard-android-optimize.txt")'
    );

    return config;
  });

  return config;
}

module.exports = withReleaseR8Optimization;
