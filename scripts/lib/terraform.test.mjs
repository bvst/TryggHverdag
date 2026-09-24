// Terraform is downloaded, not installed, so that CI, a cloud session and the
// Mac run the same version. What these tests hold is that the download cannot
// quietly become something else: an archive whose hash is wrong is refused, not
// run, and a machine this does not know is an error, not a guess.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  TERRAFORM_ENV,
  TERRAFORM_SHA256,
  TERRAFORM_VERSION,
  downloadUrl,
  ensureTerraform,
  platformKey,
} from './terraform.mjs';

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'terraform-test-'));
  made.push(dir);
  return dir;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

describe('platformKey', () => {
  test.each([
    ['linux', 'x64', 'linux_amd64'],
    ['linux', 'arm64', 'linux_arm64'],
    ['darwin', 'x64', 'darwin_amd64'],
    ['darwin', 'arm64', 'darwin_arm64'],
  ])('%s on %s is %s', (platform, arch, key) => {
    expect(platformKey(platform, arch)).toBe(key);
  });

  test('a machine with no pinned hash is refused by name, not guessed at', () => {
    expect(() => platformKey('win32', 'x64')).toThrow(/win32.*x64/);
  });

  test('every platform it knows has a hash to check the download against', () => {
    for (const key of ['linux_amd64', 'linux_arm64', 'darwin_amd64', 'darwin_arm64']) {
      expect(TERRAFORM_SHA256[key]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('downloadUrl', () => {
  test("is HashiCorp's own release server, for the pinned version", () => {
    expect(downloadUrl('linux_amd64')).toBe(
      `https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip`,
    );
  });
});

describe('TERRAFORM_ENV', () => {
  test('turns off the call home to HashiCorp, which a cloud session blocks anyway', () => {
    expect(TERRAFORM_ENV.CHECKPOINT_DISABLE).toBe('1');
  });
});

describe('ensureTerraform', () => {
  test('refuses an archive whose hash is not the pinned one, and leaves nothing behind to run', async () => {
    const root = scratch();
    const tampered = Buffer.from('not the archive HashiCorp published');

    await expect(
      ensureTerraform({
        root,
        key: 'linux_amd64',
        fetchArchive: () => Promise.resolve(tampered),
        unzip: () => {
          throw new Error('must not unzip an archive that failed its check');
        },
      }),
    ).rejects.toThrow(/does not match/);
    expect(existsSync(path.join(root, 'node_modules', '.cache', 'terraform'))).toBe(false);
  });

  test('unzips an archive whose hash matches, and hands back where the binary is', async () => {
    const root = scratch();
    const archive = Buffer.from('pretend archive');
    const unzipped = [];

    const binary = await ensureTerraform({
      root,
      key: 'linux_amd64',
      hashes: { linux_amd64: sha256(archive) },
      fetchArchive: () => Promise.resolve(archive),
      unzip: (zip, into) => {
        unzipped.push({ zip, into });
      },
    });

    expect(unzipped).toHaveLength(1);
    expect(binary).toBe(path.join(unzipped[0]?.into ?? '', 'terraform'));
    expect(binary).toContain(TERRAFORM_VERSION);
  });

  test('does not download again when the pinned version is already there', async () => {
    const root = scratch();
    const archive = Buffer.from('pretend archive');
    let downloads = 0;
    const options = {
      root,
      key: 'linux_amd64',
      hashes: { linux_amd64: sha256(archive) },
      fetchArchive: () => {
        downloads += 1;
        return Promise.resolve(archive);
      },
      unzip: (_zip, into) => {
        // What a real unzip leaves: the binary, in place.
        return import('node:fs').then(({ writeFileSync }) =>
          writeFileSync(path.join(into, 'terraform'), ''),
        );
      },
    };

    await ensureTerraform(options);
    await ensureTerraform(options);

    expect(downloads).toBe(1);
  });
});
