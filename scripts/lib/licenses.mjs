// SEC-06: dependencies are a supply chain, and their licences are part of it.
//
// The list below is what this project may ship. Copyleft licences are not on it
// — not because they are bad, but because an app distributed through the app
// stores cannot honour them, and finding that out at release time would be
// expensive. MPL-2.0 is allowed: it is file-level copyleft and safe to use as a
// dependency without relicensing our own code.

export const ALLOWED_LICENCES = [
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
];

/** Licences that are fine on their own but must be looked at by a person first. */
export const NEEDS_A_LOOK = ['UNLICENSED', 'UNKNOWN', 'SEE LICENSE IN LICENSE', ''];

/**
 * Splits a `pnpm licenses list --json` result into what is allowed and what is
 * not. A licence expression like "(MIT OR Apache-2.0)" passes when any part of
 * it is allowed, because we may pick that part.
 *
 * @param {Record<string, {name: string, versions: string[]}[]>} report
 * @param {string[]} allowed
 */
export function reviewLicences(report, allowed = ALLOWED_LICENCES) {
  const problems = [];
  for (const [licence, packages] of Object.entries(report)) {
    if (isAllowed(licence, allowed)) {
      continue;
    }
    for (const pkg of packages) {
      problems.push({
        package: pkg.name,
        versions: pkg.versions ?? [],
        licence,
        reason: NEEDS_A_LOOK.includes(licence.trim().toUpperCase())
          ? 'no licence stated — someone has to check the package'
          : 'licence is not on the allowed list',
      });
    }
  }
  return problems.sort((a, b) => a.package.localeCompare(b.package));
}

export function isAllowed(expression, allowed = ALLOWED_LICENCES) {
  const parts = expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return false;
  }
  // "A OR B" only needs one allowed option; "A AND B" needs all of them.
  return /\sAND\s/i.test(expression)
    ? parts.every((part) => allowed.includes(part))
    : parts.some((part) => allowed.includes(part));
}
