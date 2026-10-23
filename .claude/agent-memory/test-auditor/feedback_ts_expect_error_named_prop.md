---
name: ts-expect-error-named-prop
description: a "@ts-expect-error <C someProp />" test that claims "tsc fails if C ever accepts any prop" only proves C rejects THAT prop name; plant a differently named optional prop
metadata:
  type: feedback
---
Found at M3 task 2 (CALL-02-AC2, EmergencyBar, 2026-10-23): `// @ts-expect-error` above `<Bar hidden />` stays "used" whenever
`hidden` is not a prop, so `ComponentType<{ visible?: boolean }>` (even one that returns null when false) passes tsc.
**Why:** type-level "accepts no props" claims are a safety rail; a name-specific excess-prop error is narrower than the claim.
**How to apply:** plant a prop under another name, both as `ComponentType<{x?: T}>` and as a plain function taking props
(the latter may die incidentally on an assignability line, not the expect-error line; read which line fails). Ask for a
keyof check, e.g. `const none: [keyof ComponentProps<typeof C>] extends [never] ? true : false = true;`.
Related: [[m3t2-home-screen-audit]]
