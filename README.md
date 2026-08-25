# SplitSync ⏱️

> **Eliminating the "black box" of local sports timing.**
> Real-time live timing, heat tracking, and push notifications for grassroots sports — swimming, velodromes, ski racing, track & field, and beyond.

---

## 📌 Executive Summary

At local sports events (swim meets, ski races, velodrome meets, track & field), timing data is locked inside clunky desktop software or physical finish-line clipboards. Parents in packed stands or along mountain courses sit in the dark, wondering what heat or lap their athlete is on.

**SplitSync** bridges this gap. It provides:
1. **SplitSync Capture**: A zero-cost, local-first volunteer tapping app or hardware connector that logs timestamps with millisecond accuracy.
2. **SplitSync Live**: A polished spectator mobile and web experience that streams real-time heat updates, live leaderboards, lap splits, and push notifications when bookmarked athletes are on deck.

---

## 🎯 Key Objectives

* **Instant Spectator Visibility**: Real-time WebSocket updates (<50ms latency) streaming heat progression and lap/split times to spectator phones.
* **Low-Cost Data Capture**: Eliminate the requirement for $10,000+ touchpad or photobeam rigs for local grassroots clubs.
* **Offline-First Resilience**: Full local data buffering via SQLite/IndexedDB so venue cellular dropouts (concrete velodromes, remote ski slopes) never lose a timestamp.
* **Multi-Sport Versatility**: A unified core engine supporting linear time trials, multi-lane heats, lap races, and modular scoring overlays (e.g., Velodrome Points Races).

---

## 🗺️ Product Roadmap & Development Phases

Phase 1: Core Engine & "Tap-and-Sync" MVP
- Admin Web Portal (Event creation, CSV heat sheet parser)
- Volunteer Tap-Recorder UI (Large-button lane/bib logger)
- Supabase / WebSocket Real-Time Broadcast Engine
- Web-based Spectator Live Board (Active heat & split feed)

Phase 2: Mobile Spectator Experience & Push Engine
- Native iOS & Android apps (React Native / Expo)
- Athlete "Follow" / Bookmarking system
- Push Notifications ("Maya is on deck in Heat 4!")
- Advanced offline queue auto-syncing

Phase 3: Sport Overlays & Hardware Integration
- Velodrome Points Race & Criterium scoring rules overlay
- BLE Beacon / Handheld RFID sensor integration
- Legacy timing hardware API bridges (Colorado Time, MYLAPS, etc.)

---

## 🏗️ System Architecture

1. Admin Web Portal imports CSV Heat Sheets to Cloud Backend.
2. Volunteer Tap App / BLE Receiver logs local taps to Local Buffer (IndexedDB / SQLite).
3. Local Buffer syncs via WebSocket / MQTT to Cloud Backend (Supabase).
4. Cloud Backend streams real-time state re-renders to Spectator Live App and sends alerts to Push Service (FCM/APNs).

---

## 📊 Database Schema Overview

The relational database structure (PostgreSQL / Supabase) separates core race metadata, real-time split capture, and scoring overlays:

- `events`: id, title, sport_type, location, starts_at, status
- `athletes`: id, name, bib_number, team, category
- `heats`: id, event_id, name, sequence_order, status (upcoming, active, completed)
- `heat_entries`: id, heat_id, athlete_id, lane_or_position
- `time_stamps`: id, heat_entry_id, split_name (e.g., "Lap 2", "Finish"), elapsed_ms, recorded_at
- `scoring_events`: id, heat_entry_id, event_type (sprint_points, lap_gained), points, lap_number

---

## 🚴 Supported Sports & Rules Engine

| Sport Category | Key Metrics & Data Captured | Special Scoring Support |
| :--- | :--- | :--- |
| **Swimming** | Heat/Lane assignments, 25m/50m splits, final time | Age group & stroke filter |
| **Velodrome Track Cycling** | Lap counts, lap split times, lead/chase group split | Points Race overlay (Sprint laps: 5, 3, 2, 1 pts; Lap gained: +20 pts) |
| **Alpine & Cross-Country Skiing** | Interval splits (Sector 1, Sector 2), finish time, delta (+/-) | Run 1 + Run 2 combined time |
| **Track & Field** | Lane assignment, lap splits (400m/800m/1500m), finish time | Multi-heat summary rankings |

---

## 💻 Recommended Tech Stack

* **Frontend Framework**: React / Next.js (Admin Portal), React Native + Expo (Cross-platform Mobile Apps)
* **Backend & Database**: Supabase (PostgreSQL, Row-Level Security, Realtime Broadcast Channels)
* **State & Local Persistence**: TanStack Query + WatermelonDB / SQLite (Offline-first architecture)
* **Push Notifications**: Expo Push API / Firebase Cloud Messaging (FCM)
* **Styling**: Tailwind CSS / NativeWind

---

## 🚀 Getting Started (Development)

### Prerequisites
* Node.js >= 18.x
* npm / pnpm / yarn
* Docker (for local Supabase instance)

### Setup Instructions

```bash
# 1. Clone the repository
git clone [https://github.com/your-org/splitsync.git](https://github.com/your-org/splitsync.git)
cd splitsync

# 2. Install dependencies
pnpm install

# 3. Start local Supabase backend
pnpm supabase start

# 4. Run the Admin Web & Recorder development server
pnpm dev

# 5. Launch mobile spectator app (Expo)
cd apps/mobile
pnpm start
