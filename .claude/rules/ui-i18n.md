---
paths:
  - "apps/mobile/src/**/*.tsx"
---
# UI rules
- No hard-coded text: every string goes through translation keys, with both
  `nb` and `en` present (D-014).
- Designed for night, stress and gloves: large touch targets, and 112 always
  visible on the home and journey screens (CALL-02).
- Every interactive element has a screen-reader label.
