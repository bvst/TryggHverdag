// SPIKE-01: a local config plugin, so iOS Debug builds carry their JavaScript
// and a 45-minute run never depends on Metro. Spike-only: never copy into the
// product.
//
// Expo's template "Bundle React Native code and images" build phase exports
// SKIP_BUNDLING=1 for every Debug configuration, and React Native's bundling
// script checks SKIP_BUNDLING before FORCE_BUNDLING. So FORCE_BUNDLING=1 (set in
// eas.json) alone never bundles. This plugin replaces that one export with an
// unset, and FORCE_BUNDLING then does its job for the simulator.
//
// It throws unless the phase and the line are each found exactly once: a
// SKIP_BUNDLING left in place would make the app need Metro, silently.
const { withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = 'Bundle React Native code and images';
const EXPORT_LINE = 'export SKIP_BUNDLING=1';
const REPLACEMENT = 'unset SKIP_BUNDLING # SPIKE-01: Debug builds bundle too';

const unquote = (value) => String(value ?? '').replace(/^"|"$/g, '');
const count = (text, part) => text.split(part).length - 1;

module.exports = (config) =>
  withXcodeProject(config, (mod) => {
    const phases = mod.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const matching = Object.values(phases).filter(
      (phase) => typeof phase === 'object' && unquote(phase.name) === PHASE_NAME,
    );
    if (matching.length !== 1) {
      throw new Error(
        `SPIKE-01 plugin: expected one "${PHASE_NAME}" build phase, found ${matching.length}`,
      );
    }
    const [phase] = matching;
    const script = String(phase.shellScript);
    if (count(script, EXPORT_LINE) === 0 && count(script, REPLACEMENT) === 1) return mod;
    if (count(script, EXPORT_LINE) !== 1) {
      throw new Error(
        `SPIKE-01 plugin: expected "${EXPORT_LINE}" once in "${PHASE_NAME}", ` +
          `found it ${count(script, EXPORT_LINE)} times; the template has changed`,
      );
    }
    phase.shellScript = script.replace(EXPORT_LINE, REPLACEMENT);
    return mod;
  });
