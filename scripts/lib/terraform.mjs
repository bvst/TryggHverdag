// Terraform, pinned: one version, checked by hash, the same everywhere.
//
// Downloaded rather than installed, so CI, a cloud session and the Mac plan
// with the same binary — a plan made by one Terraform and applied by another is
// how state files get upgraded by surprise. The hashes are HashiCorp's own
// (terraform_<version>_SHA256SUMS), copied here once and checked on every
// download, the same way ci.yml pins gitleaks: a changed archive is refused,
// not run.
//
// infra/staging/versions.tf says `required_version = "~> 1.16.0"`; a test in
// scripts/infra.test.mjs holds that and this constant together.
import path from 'node:path';
import process from 'node:process';
import { ensurePinnedBinary, fetchArchiveFrom } from './pinned-binary.mjs';
import { run } from './proc.mjs';

export const TERRAFORM_VERSION = '1.16.4';

export const TERRAFORM_SHA256 = {
  linux_amd64: 'dc94af0eef1147718ad7c8daea792ed199e3e0492eec180d0adafa2a65a879df',
  linux_arm64: '8263f301cb1a24489a4adeed147bf28504053f77237b3ea97a0ef2972659de30',
  darwin_amd64: '2ee4b62064086e4b24b0d6cf2e61718fbaf0556feba990f708a5e32557554b3b',
  darwin_arm64: '42cfdf97ad722f79085fe2279b06d4b8680172de3534b22eeddd9a0fbbe7b8f1',
};

/**
 * Set on every Terraform run. CHECKPOINT_DISABLE stops the call home to
 * HashiCorp's version service — which a cloud session's network blocks
 * anyway, and which nothing here needs. TF_IN_AUTOMATION trims the advice
 * aimed at a person at a terminal.
 */
export const TERRAFORM_ENV = { CHECKPOINT_DISABLE: '1', TF_IN_AUTOMATION: '1' };

/** HashiCorp's name for this machine, or an error naming it when no hash is pinned. */
export function platformKey(platform = process.platform, arch = process.arch) {
  const os = { linux: 'linux', darwin: 'darwin' }[platform];
  const cpu = { x64: 'amd64', arm64: 'arm64' }[arch];
  const key = os === undefined || cpu === undefined ? undefined : `${os}_${cpu}`;
  if (key === undefined || TERRAFORM_SHA256[key] === undefined) {
    throw new Error(
      `No pinned Terraform for ${platform} on ${arch}. Add its hash from ` +
        `terraform_${TERRAFORM_VERSION}_SHA256SUMS to scripts/lib/terraform.mjs.`,
    );
  }
  return key;
}

export function downloadUrl(key) {
  return `https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_${key}.zip`;
}

function unzipWithSystemTool(zip, into) {
  const result = run('unzip', ['-o', '-q', zip, 'terraform', '-d', into], { timeout: 120_000 });
  if (!result.ok) {
    throw new Error(`Unzipping Terraform failed (is unzip installed?): ${result.output.trim()}`);
  }
}

/**
 * The path of the pinned Terraform, downloading and checking it the first time
 * (scripts/lib/pinned-binary.mjs does the checking and the caching).
 *
 * @param {{
 *   root?: string,
 *   key?: string,
 *   hashes?: Record<string, string>,
 *   fetchArchive?: (url: string) => Promise<Buffer>,
 *   unzip?: (zip: string, into: string) => unknown,
 * }} options — everything but `root` exists so a test can stand in for the network
 */
export function ensureTerraform({
  root = process.cwd(),
  key = platformKey(),
  hashes = TERRAFORM_SHA256,
  fetchArchive = fetchArchiveFrom,
  unzip = unzipWithSystemTool,
} = {}) {
  return ensurePinnedBinary({
    dir: path.join(root, 'node_modules', '.cache', 'terraform', TERRAFORM_VERSION, key),
    binaryName: 'terraform',
    what: `Terraform ${TERRAFORM_VERSION} for ${key}`,
    url: downloadUrl(key),
    sha256: hashes[key],
    fetchArchive,
    extract: unzip,
  });
}
