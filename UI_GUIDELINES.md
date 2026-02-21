# UI Guidelines — Clean & Minimal Redesign

Reference for screen agents implementing the UI overhaul.

## Visual Noise Reduction
- **Remove all 3px left accent stripes** from cards (template cards, history cards, etc). Cards become plain surface rectangles.
- Remove unnecessary borders on search bars — surface/background contrast is enough.
- Reduce empty state icons from 64px to 48px.

## Touch Targets
- All buttons: `minHeight: 44px` minimum (Apple HIG).
- Primary action buttons: `minHeight: 50px` (use `layout.buttonHeight`).
- Stepper buttons (TemplateDetail): 36x36 + `hitSlop`.
- Workout set checkbox: 36x36.

## Spacing
- Screen horizontal padding: `layout.screenPaddingH` (20px).
- Card gaps: `layout.cardGap` (12px).
- Section separation: `layout.sectionGap` (32px).

## Import Pattern
```ts
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';
```

## Constraints
- Do NOT change `testID` attributes.
- Do NOT restructure components or split files.
- Do NOT change business logic, state, or data flow.
- Do NOT modify services/, contexts/, utils/, types/, constants/.
- Do NOT add new dependencies.
- Do NOT touch theme token files (lead agent only).
