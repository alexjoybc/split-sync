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

    // Drop any plain (non-removal) entry for this permission first. A
    // `tools:node="remove"` sibling in the *same* manifest does not cancel
    // a plain entry — the merger treats same-file duplicates as a union and
    // only warns ("no other declaration present"), so the permission would
    // still ship. The removal directive only has an effect on declarations
    // coming from a lower-priority manifest (e.g. the dev-client tooling).
    const permissions = (manifest["uses-permission"] ?? []).filter(
      (p) =>
        !(
          p.$?.["android:name"] === "android.permission.SYSTEM_ALERT_WINDOW" &&
          p.$?.["tools:node"] !== "remove"
        )
    );

    const alreadyPresent = permissions.some(
      (p) =>
        p.$?.["android:name"] === "android.permission.SYSTEM_ALERT_WINDOW" &&
        p.$?.["tools:node"] === "remove"
    );

    manifest["uses-permission"] = alreadyPresent
      ? permissions
      : [
          ...permissions,
          {
            $: {
              "android:name": "android.permission.SYSTEM_ALERT_WINDOW",
              "tools:node": "remove",
            },
          },
        ];

    return mod;
  });
};
