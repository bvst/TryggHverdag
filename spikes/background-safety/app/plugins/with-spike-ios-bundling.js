// SPIKE-01: a local config plugin, so iOS Debug builds carry a production
// JavaScript bundle and a 45-minute run never depends on Metro, as Android's
// `debuggableVariants = []` does. The native build stays Debug: that is what
// the SDK's licence (3.5) lets run without a key. Spike-only: never copy into
// the product.
//
// Two edits to Expo's "Bundle React Native code and images" build phase:
//
// 1. Expo exports SKIP_BUNDLING=1 for every Debug configuration, and React
//    Native's react-native-xcode.sh stops on it. That line becomes an unset.
// 2. react-native-xcode.sh builds a development bundle (`--dev true`) for any
//    Debug configuration, and Expo SDK 57 refuses to start a development
//    bundle that was not loaded from Metro ("Cannot create devtools websocket
//    connections in embedded environments", build dc1aa815). So that one call
//    runs with CONFIGURATION=Release in its own environment only. The script
//    reads CONFIGURATION for nothing else that runs on a simulator: it then
//    bundles with `--dev false --minify false` and compiles with hermesc -O
//    instead of -Og, to the same paths. The rest of the build stays Debug.
//
// Each edit throws unless its text is found exactly once (or its replacement
// exactly once, when the edit is already applied): a bundle Metro is needed
// for would otherwise be found only at run time.
const { withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = 'Bundle React Native code and images';
const SKIP_LINE = 'export SKIP_BUNDLING=1';
const SKIP_REPLACEMENT = 'unset SKIP_BUNDLING # SPIKE-01: Debug builds bundle too';
const SCRIPT_CALL = '/scripts/react-native-xcode.sh';
const CALL_PREFIX = 'CONFIGURATION=Release ';
/** The shell script as the project file stores it: newlines are written `\n`. */
const NEWLINE = '\\n';

const unquote = (value) => String(value ?? '').replace(/^"|"$/g, '');
const count = (text, part) => text.split(part).length - 1;
const fail = (why) => {
  throw new Error(`SPIKE-01 plugin: ${why} in "${PHASE_NAME}"; the template has changed`);
};

function unsetSkipBundling(script) {
  if (count(script, SKIP_LINE) === 0 && count(script, SKIP_REPLACEMENT) === 1) return script;
  if (count(script, SKIP_LINE) !== 1) {
    fail(`expected "${SKIP_LINE}" once, found it ${count(script, SKIP_LINE)} times`);
  }
  return script.replace(SKIP_LINE, SKIP_REPLACEMENT);
}

function productionBundle(script) {
  const lines = script.split(NEWLINE);
  const calls = lines.filter((line) => line.includes(SCRIPT_CALL));
  if (calls.length !== 1) {
    fail(`expected one line calling "${SCRIPT_CALL}", found ${calls.length}`);
  }
  const at = lines.indexOf(calls[0]);
  const prefixes = count(lines[at], CALL_PREFIX);
  if (prefixes === 1 && lines[at].startsWith(CALL_PREFIX)) return script;
  if (prefixes !== 0) fail(`found "${CALL_PREFIX.trim()}" somewhere unexpected`);
  lines[at] = CALL_PREFIX + lines[at];
  return lines.join(NEWLINE);
}

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
    phase.shellScript = productionBundle(unsetSkipBundling(String(phase.shellScript)));
    return mod;
  });
