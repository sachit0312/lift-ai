# Testing Strategy: Component Tests + Maestro E2E

## Goal
Automate bug detection across auth, workout, and template flows using two layers: component tests (RNTL) and end-to-end tests (Maestro).

## Layer 1: Component Tests (React Native Testing Library)

**Setup:** Add `@testing-library/react-native` to devDependencies. Mock `../services/database` and `../services/sync`.

**Screens to test:**
- ExercisePickerScreen: search filtering, muscle chip toggling, form validation, type selection
- WorkoutScreen (idle): template list, upcoming workout card, start buttons
- WorkoutScreen (active): set completion, tag cycling, add set
- LoginScreen: inputs render, login triggers auth
- ProfileScreen: user email displayed, logout button

**Files:** `src/screens/__tests__/<Screen>.test.tsx`

**Run:** `npm test`

## Layer 2: E2E Tests (Maestro)

**Setup:** `brew install maestro`. Flows in `maestro/` at project root.

**Flow structure:**
```
maestro/
  setup/
    seed-exercises.yaml
    seed-template.yaml
  auth/
    login.yaml
    signup.yaml
    logout.yaml
  workout/
    start-empty.yaml
    start-template.yaml
    complete-set.yaml
    finish-workout.yaml
  templates/
    create-template.yaml
    add-exercise.yaml
    create-exercise.yaml
```

**Test data:** Setup flows create exercises/templates through UI. Auth flows use a dedicated Supabase test account.

**Run:** `maestro test maestro/`

## testID additions needed
- WorkoutScreen: weight/reps inputs, checkboxes, start/finish buttons
- ExercisePickerScreen: muscle chips, save button, name input
- LoginScreen: email/password inputs, login button
- ProfileScreen: logout button

## npm scripts
```json
"test:unit": "jest",
"test:e2e": "maestro test maestro/",
"test:all": "jest && maestro test maestro/"
```
