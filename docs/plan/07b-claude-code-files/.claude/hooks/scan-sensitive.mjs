#!/usr/bin/env node
// Blocks secrets, real-looking personal data and location logging (PRIV-07, RG-07).
import { readInput, relPath, block } from './lib.mjs';

const input = await readInput();
const ti = input?.tool_input ?? {};
const file = ti.file_path ?? ti.notebook_path ?? '';
const text = String(ti.content ?? ti.new_string ?? ti.new_source ?? '');
if (!text) process.exit(0);
const rel = file ? relPath(file, input.cwd) : '';

// The single allowed home for fictitious phone numbers used by tests.
const PHONE_FIXTURES = 'packages/test-kit/src/fixtures/phone-numbers.ts';

const checks = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-\/+]{16,}['"]/i, 'what looks like a hard-coded secret'],
  [/\blog(?:ger)?\s*\.\s*(trace|debug|info|warn|error|fatal)\s*\([^)]*\b(lat|lon|lng|latitude|longitude|coords?|position)\b/i, 'location data in a log statement (PRIV-07)'],
];
for (const [re, what] of checks) {
  if (re.test(text)) block(`Blocked: ${rel || 'this edit'} contains ${what}. Use the secret store or scrubbed logging instead.`);
}
if (rel !== PHONE_FIXTURES && /(\+47|0047)[\s-]?[49]\d{2}[\s-]?\d{2}[\s-]?\d{3}\b/.test(text)) {
  block(`Blocked: ${rel || 'this edit'} contains a real-looking Norwegian mobile number. ` +
        `Use the test-kit phone builder; only ${PHONE_FIXTURES} may hold fictitious numbers (RG-07).`);
}
process.exit(0);
