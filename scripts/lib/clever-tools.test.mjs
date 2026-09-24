// Clever Cloud's command-line tool, as deploy-staging.yml gets it: one
// self-contained binary, checked by hash, rather than `npx`, which resolved
// about 180 unlocked packages afresh on every deploy with the staging key in
// the environment (privacy-security-reviewer, INF-07).
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CLEVER_TOOLS_SHA256,
  CLEVER_TOOLS_VERSION,
  cleverToolsUrl,
  ensureCleverTools,
} from './clever-tools.mjs';

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'clever-tools-test-'));
  made.push(dir);
  return dir;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

describe('the pinned command-line tool', () => {
  test('is an exact version with a hash to check it against — never "latest"', () => {
    expect(CLEVER_TOOLS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CLEVER_TOOLS_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("comes from Clever Cloud's own release of that version", () => {
    expect(cleverToolsUrl()).toBe(
      `https://github.com/CleverCloud/clever-tools/releases/download/${CLEVER_TOOLS_VERSION}/clever-tools-${CLEVER_TOOLS_VERSION}_linux.tar.gz`,
    );
  });
});

describe('ensureCleverTools', () => {
  test('refuses an archive whose hash is not the pinned one, and unpacks nothing', async () => {
    await expect(
      ensureCleverTools({
        root: scratch(),
        fetchArchive: () => Promise.resolve(Buffer.from('something else')),
        extract: () => {
          throw new Error('must not unpack an archive that failed its check');
        },
      }),
    ).rejects.toThrow(/does not match/);
  });

  test('hands back the binary from an archive that matches', async () => {
    const archive = Buffer.from('pretend archive');

    const binary = await ensureCleverTools({
      root: scratch(),
      sha256: sha256(archive),
      fetchArchive: () => Promise.resolve(archive),
      extract: (_archive, into) => {
        writeFileSync(path.join(into, 'clever'), 'pretend binary');
      },
    });

    expect(path.basename(binary)).toBe('clever');
    expect(existsSync(binary)).toBe(true);
  });
});
