// A tool downloaded once, checked by hash, and cached under node_modules/.cache
// — for tools that are not npm packages, or whose npm package would pull in
// dependencies nothing locks. Terraform (scripts/lib/terraform.mjs) and Clever
// Cloud's command-line tool (scripts/lib/clever-tools.mjs) come this way.
//
// Two rules. An archive whose hash is not the pinned one is refused, not run.
// And the cache is trusted once the binary exists, so the binary is unpacked
// into a folder of its own and moved into place only when whole: a half-written
// one must never land where a later run would trust it.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export async function fetchArchiveFrom(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed: HTTP ${String(response.status)}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The path of the binary, downloading, checking and unpacking it the first time.
 *
 * @param {{
 *   dir: string,
 *   binaryName: string,
 *   what: string,
 *   url: string,
 *   sha256: string | undefined,
 *   fetchArchive: (url: string) => Promise<Buffer>,
 *   extract: (archive: string, into: string) => unknown,
 * }} options — `what` names the tool in messages; `extract` must leave
 *   `binaryName` directly inside `into`. A tool that ships as a folder, such as
 *   Maestro's launcher and its jars, gives a path instead (`maestro/bin/maestro`):
 *   then everything `extract` unpacked becomes `dir`, moved into place whole.
 */
export async function ensurePinnedBinary({
  dir,
  binaryName,
  what,
  url,
  sha256,
  fetchArchive,
  extract,
}) {
  const binary = path.join(dir, binaryName);
  if (existsSync(binary)) {
    return binary;
  }

  const archive = await fetchArchive(url);
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== sha256) {
    throw new Error(
      `The ${what} archive does not match its pinned hash ` +
        `(expected ${String(sha256)}, got ${actual}). Refusing to run it.`,
    );
  }

  const partial = `${dir}.partial-${String(process.pid)}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    const file = path.join(partial, 'archive');
    writeFileSync(file, archive);
    const shipsAsFolder = path.dirname(binaryName) !== '.';
    // A folder tool is unpacked on its own, so the archive is not moved with it.
    const into = shipsAsFolder ? path.join(partial, 'tree') : partial;
    mkdirSync(into, { recursive: true });
    await extract(file, into);
    const unpacked = path.join(into, binaryName);
    if (!existsSync(unpacked)) {
      throw new Error(`The ${what} archive held no ${binaryName} binary.`);
    }
    chmodSync(unpacked, 0o755);
    if (shipsAsFolder) {
      // Whatever an earlier, interrupted run left has no binary in it (that
      // was checked above), so it is not trusted: it is replaced.
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(path.dirname(dir), { recursive: true });
      renameSync(into, dir);
    } else {
      mkdirSync(dir, { recursive: true });
      renameSync(unpacked, binary);
    }
  } finally {
    rmSync(partial, { recursive: true, force: true });
  }
  return binary;
}
