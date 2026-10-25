/**
 * The shared UI kit (CALL-02, approach 1; GRP-02, "The home screen task 2
 * builds", item 5): `Screen`, which draws the 112 bar on every screen, the
 * pieces screens are built from, the one palette, and the fallback a screen
 * that crashed shows. Only routes under src/app/ draw `Screen`; features use
 * the pieces (an ESLint rule, CALL-02-AC2), and a feature that draws several
 * views inside one route starts each new one at its top, with focus on its
 * heading, by `useViewStartsAtTop` (GRP-02-AC11).
 */
export { ErrorFallback } from './error-fallback';
export { Body, Button, Heading, Message, TextField, Waiting } from './kit';
export { useViewStartsAtTop } from './new-view';
export { contrastPairs, palette } from './palette';
export { Screen } from './screen';
