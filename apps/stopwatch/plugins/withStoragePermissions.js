/**
 * Expo config plugin: cap legacy storage permissions to Android 12 (API 32).
 *
 * READ_EXTERNAL_STORAGE and WRITE_EXTERNAL_STORAGE are superseded by granular
 * media permissions on Android 13+ (API 33). Adding maxSdkVersion="32" tells
 * the Play Store (and the OS) that these permissions are not requested on
 * API 33+ devices, avoiding the "legacy storage access" warning during review.
 *
 * Some dependencies (e.g. expo-audio, react-native-volume-manager) inject
 * these permissions without maxSdkVersion. This plugin overrides them.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

const STORAGE_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

/** @param {import('@expo/config-plugins').ExpoConfig} config */
function withStoragePermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    /** @type {Array<{$: Record<string, string>}>} */
    const permissions = manifest['uses-permission'] ?? [];

    for (const permName of STORAGE_PERMISSIONS) {
      const existing = permissions.find(
        (p) => p.$['android:name'] === permName
      );

      if (existing) {
        // Override whatever maxSdkVersion (or lack thereof) a library added.
        existing.$['android:maxSdkVersion'] = '32';
        // tools:replace is not needed here because we are mutating the merged
        // manifest object directly inside the prebuild phase — Gradle merge has
        // not run yet.
      } else {
        // The permission was not added by any dependency; add it ourselves with
        // the cap so that it is present but constrained on API ≤ 32 devices.
        permissions.push({
          $: {
            'android:name': permName,
            'android:maxSdkVersion': '32',
          },
        });
      }
    }

    manifest['uses-permission'] = permissions;
    return config;
  });
}

module.exports = withStoragePermissions;
