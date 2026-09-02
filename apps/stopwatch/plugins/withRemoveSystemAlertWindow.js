/**
 * Expo config plugin: remove SYSTEM_ALERT_WINDOW from the merged manifest.
 *
 * The Expo development client pulls in android.permission.SYSTEM_ALERT_WINDOW
 * (needed for its in-app overlay). Even though production EAS builds exclude
 * the dev client, the permission can still surface through transitive merges.
 * Google Play flags it as a "special app access" permission and will reject
 * the submission.
 *
 * Adding tools:node="remove" in the app manifest is the standard Android
 * manifest-merger mechanism to strip a permission that comes from a dependency.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @returns {import('@expo/config-plugins').ExpoConfig}
 */
module.exports = function withRemoveSystemAlertWindow(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Ensure the tools namespace is declared on the root <manifest> element.
    if (!manifest.$["xmlns:tools"]) {
      manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    // Locate or create the uses-permission removal entry.
    const permissions = manifest["uses-permission"] ?? [];
    const alreadyPresent = permissions.some(
      (p) =>
        p.$?.["android:name"] === "android.permission.SYSTEM_ALERT_WINDOW" &&
        p.$?.["tools:node"] === "remove"
    );

    if (!alreadyPresent) {
      permissions.push({
        $: {
          "android:name": "android.permission.SYSTEM_ALERT_WINDOW",
          "tools:node": "remove",
        },
      });
      manifest["uses-permission"] = permissions;
    }

    return mod;
  });
};
