# ADR 0003: Expo For The Native Tracker

## Status

Accepted.

## Decision

Use Expo/React Native for one shared Android and iOS tracker app. Develop Android with direct native builds through Android Studio and USB-connected devices.

## Rationale

The tracker needs native persistent storage, reliable deep links for magic links, and future hardware integrations. Expo supplies these while retaining one TypeScript codebase. Expo Go is useful for visual experiments but is not relied on for stable authentication callbacks.

## Consequences

- Android package and iOS bundle ID: `org.splitsync.tracker`.
- Mobile magic-link callback: `org.splitsync.tracker://auth/callback`.
- Android local builds require JDK 17, Android SDK, USB debugging, and `expo run:android`.
- iOS validation will require Xcode and a later device/TestFlight workflow.
