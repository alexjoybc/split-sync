import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    rules: {
      // This flags standard data-fetch-on-mount / realtime-subscription
      // effects (see src/lib/useRaceData.ts, useEventAccess.ts) as errors.
      // Those are intentional patterns for this app, not bugs, so keep
      // this as a warning rather than a CI-blocking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
