# lift.ai

**AI-powered weightlifting tracker for iOS**

[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![iOS](https://img.shields.io/badge/iOS-16+-000000?logo=apple&logoColor=white)](https://developer.apple.com/ios/)

A React Native/Expo fitness app that tracks weightlifting workouts with smart features like confidence-aware 1RM estimation, iOS Live Activity widgets, cloud sync via Supabase, and AI coaching through an MCP server integration with Claude.

---

## Features

- **Smart Set Tracking** -- Weight, reps, and RPE with auto-fill from previous sessions. Supports working, warmup, failure, and drop sets.
- **1RM Estimation Engine** -- Dual-path system: RPE lookup (Tuchscherer table) or rep-range-weighted ensemble (Epley/Brzycki/Wathen). Confidence tiers (HIGH/MEDIUM/LOW) with 42-day freshness decay.
- **iOS Live Activity** -- Persistent lock screen widget showing current exercise, set counter, and rest timer with animated countdown.
- **Template System** -- Create workout templates with drag-to-reorder, configurable warmup/working sets and rest timers. Auto-detects changes and offers to update templates after workouts.
- **Cloud Sync** -- Bidirectional SQLite <> Supabase sync. Offline-first: works without internet, syncs when connected.
- **AI Coach Integration** -- Claude connects via MCP server ([lift-ai-mcp](https://github.com/sachitgoyal/lift-ai-mcp)) to analyze training, create workout plans, and provide coaching tips.
- **Personal Records** -- Automatic PR detection with confidence-aware tracking. Shows current vs. all-time PRs.
- **Rest Timer** -- Per-exercise configurable rest timer with haptic feedback, notifications, and Live Activity countdown.

---

## Architecture

```
Local-first design
SQLite (expo-sqlite) <──── bidirectional sync ────> Supabase (PostgreSQL)
```

- **Navigation**: 5-tab layout -- Workout / Templates / History / Exercises / Profile
- **Auth**: Supabase Auth (email + Google OAuth)
- **AI Coaching**: Separate MCP server repo (`lift-ai-mcp`) connects Claude to your training data
- **Live Activity**: Native iOS module via `shared-user-defaults` for lock screen widgets

### Project Structure

```
lift-ai/
├── src/
│   ├── components/       # Reusable UI components
│   ├── screens/          # Tab and modal screens
│   ├── services/         # Database, sync, auth logic
│   ├── hooks/            # Custom React hooks
│   ├── contexts/         # React context providers
│   ├── utils/            # 1RM calculations, helpers
│   ├── types/            # TypeScript type definitions
│   ├── constants/        # App-wide constants
│   ├── navigation/       # Tab and stack navigators
│   └── theme/            # Colors, typography, spacing
├── modules/
│   └── shared-user-defaults/  # iOS Live Activity bridge
├── ios/                  # Native iOS project + widgets
├── supabase/             # Migrations and DB schema
├── maestro/              # E2E test flows
├── plugins/              # Expo config plugins
└── assets/               # Images and fonts
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Xcode 15+
- Expo CLI (`npm install -g expo-cli`)

### Install

```bash
npm install
```

### Configure

Create a `.env` file in the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Run

```bash
npx expo run:ios           # Simulator
npx expo run:ios --device  # Physical device
```

### Test

```bash
npm test                   # Unit tests (Jest)
maestro test maestro/...   # E2E tests (Maestro)
```

---

## Built With

| Layer | Technology |
|---|---|
| Framework | React Native 0.81 + Expo 54 |
| Language | TypeScript |
| Local DB | expo-sqlite |
| Cloud | Supabase (PostgreSQL + Auth) |
| Lock Screen | iOS Live Activity (ActivityKit) |
| Error Tracking | Sentry |
| Unit Tests | Jest |
| E2E Tests | Maestro |
| AI Integration | Claude via MCP server |

---

## License

This project is proprietary. All rights reserved.
