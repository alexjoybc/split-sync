/**
 * Expo config plugin: strip RECORD_AUDIO from the merged Android manifest.
 *
 * expo-audio transitively declares android.permission.RECORD_AUDIO even though
 * the Stopwatch app only plays back synthesised PCM tones and never records.
 * Google Play's static analyser rejects apps that declare microphone access
 * without a legitimate use-case justification, so we add a removal directive
 * here so that the merged manifest does not contain the permission.
 *
 * The `tools:node="remove"` attribute is the standard Android Manifest Merger
 * mechanism for stripping a permission added by a library or plugin.
 *
 * Reference: https://developer.android.com/studio/build/manage-manifests#merge_rule_markers
 */

const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
const withStripRecordAudio = (config) => {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;

    // Ensure the tools namespace is declared on the root <manifest> element.
    if (!manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Drop any plain (non-removal) entry for this permission first. A
    // `tools:node="remove"` sibling in the *same* manifest does not cancel
    // a plain entry — the merger treats same-file duplicates as a union and
    // only warns ("no other declaration present"), so the permission would
    // still ship. The removal directive only has an effect on declarations
    // coming from a lower-priority manifest (e.g. expo-audio's AAR).
    const permissions = (manifest.manifest['uses-permission'] ?? []).filter(
      (p) =>
        !(
          p.$['android:name'] === 'android.permission.RECORD_AUDIO' &&
          p.$['tools:node'] !== 'remove'
        ),
    );

    const alreadyPresent = permissions.some(
      (p) =>
        p.$['android:name'] === 'android.permission.RECORD_AUDIO' &&
        p.$['tools:node'] === 'remove',
    );

    manifest.manifest['uses-permission'] = alreadyPresent
      ? permissions
      : [
          ...permissions,
          {
            $: {
              'android:name': 'android.permission.RECORD_AUDIO',
              'tools:node': 'remove',
            },
          },
        ];

    return mod;
  });
};

module.exports = withStripRecordAudio;
