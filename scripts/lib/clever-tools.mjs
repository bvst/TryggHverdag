// Clever Cloud's command-line tool, for deploy-staging.yml: the self-contained
// Linux binary from Clever Cloud's own release, checked by hash
// (scripts/lib/pinned-binary.mjs).
//
// Not `npx clever-tools@…`: that pinned only the top package and resolved about
// 180 others afresh on every deploy, none of them locked, audited or
// licence-checked, in a job holding the staging key (privacy-security-reviewer,
// INF-07). The binary has no dependencies and no Node requirement.
//
// **Where the hash comes from, stated plainly:** Clever Cloud publishes no
// checksum that this session could reach. The hash below was computed on
// 2026-09-24 from the archive downloaded over TLS from the GitHub release, and
// the binary in it reported `5.0.2`. It proves the file has not changed since,
// not that it was genuine then (D-077).
import path from 'node:path';
import process from 'node:process';
import { ensurePinnedBinary, fetchArchiveFrom } from './pinned-binary.mjs';
import { run } from './proc.mjs';

export const CLEVER_TOOLS_VERSION = '5.0.2';

export const CLEVER_TOOLS_SHA256 =
  '01fb1260bd9cdfe0e392e4e0494466f4e6a6e83907aec3c1f07757efd08cb3ed';

/** Linux on x64 only: the tool runs in deploy-staging.yml, on ubuntu-26.04, and nowhere else. */
export function cleverToolsUrl() {
  return `https://github.com/CleverCloud/clever-tools/releases/download/${CLEVER_TOOLS_VERSION}/clever-tools-${CLEVER_TOOLS_VERSION}_linux.tar.gz`;
}

function extractWithTar(archive, into) {
  const result = run(
    'tar',
    [
      '-xzf',
      archive,
      '-C',
      into,
      '--strip-components=1',
      `clever-tools-${CLEVER_TOOLS_VERSION}_linux/clever`,
    ],
    { timeout: 120_000 },
  );
  if (!result.ok) {
    throw new Error(`Unpacking Clever Tools failed: ${result.output.trim()}`);
  }
}

/**
 * @param {{
 *   root?: string,
 *   sha256?: string,
 *   fetchArchive?: (url: string) => Promise<Buffer>,
 *   extract?: (archive: string, into: string) => unknown,
 * }} options — everything but `root` exists so a test can stand in for the network
 */
export function ensureCleverTools({
  root = process.cwd(),
  sha256 = CLEVER_TOOLS_SHA256,
  fetchArchive = fetchArchiveFrom,
  extract = extractWithTar,
} = {}) {
  return ensurePinnedBinary({
    dir: path.join(root, 'node_modules', '.cache', 'clever-tools', CLEVER_TOOLS_VERSION),
    binaryName: 'clever',
    what: `Clever Tools ${CLEVER_TOOLS_VERSION}`,
    url: cleverToolsUrl(),
    sha256,
    fetchArchive,
    extract,
  });
}
