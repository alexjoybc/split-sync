// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/**", "android/**", "ios/**"],
  },
  {
    rules: {
      // This flags standard data-fetch-on-mount / auth-session-sync effects
      // (see App.tsx) as errors. Those are intentional patterns for this
      // app, not bugs, so keep this as a warning rather than a CI-blocking
      // error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
