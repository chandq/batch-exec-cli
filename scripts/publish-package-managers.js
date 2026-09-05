#!/usr/bin/env node
/**
 * Render and push the Homebrew formula and Scoop manifest for batch-exec-cli.
 *
 * The formula/manifest are kept in EXTERNAL repos (they are not vendored here):
 *   - Homebrew: https://github.com/chandq/homebrew-tap   (tap name: chandq/tap)
 *   - Scoop:    https://github.com/chandq/scoop-bucket
 *
 * Source of truth for the version is this repo's package.json at sync time, so
 * this must run on the default branch AFTER the release workflow bumped it.
 *
 * Safety: refuses to run outside GitHub Actions unless passed --dry-run.
 *   --dry-run renders the files locally (fetches the sha256 when reachable,
 *   otherwise a placeholder) and prints them without any git writes.
 *
 * Env:
 *   RELEASE_TOKEN        token with push access to the two external repos
 *   NPM_REGISTRY         default https://registry.npmjs.org
 *   MAX_REGISTRY_WAIT_MS default 60000 (anonymous reads hit CDN replication)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const {
  name: PKG_NAME,
  version: PKG_VERSION,
  description: PKG_DESC
} = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

const GITHUB_OWNER = 'chandq';
const HOMEBREW_TAP_REPO = `${GITHUB_OWNER}/homebrew-tap`; // -> tap chandq/tap
const SCOOP_BUCKET_REPO = `${GITHUB_OWNER}/scoop-bucket`;
const HOMEPAGE = `https://github.com/${GITHUB_OWNER}/batch-exec-cli`;
const IS_DRY_RUN = process.argv.includes('--dry-run');
const IS_CI = process.env.GITHUB_ACTIONS === 'true';
const RELEASE_TOKEN = process.env.RELEASE_TOKEN || '';
const NPM_REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const MAX_REGISTRY_WAIT_MS = Number(process.env.MAX_REGISTRY_WAIT_MS || 60000);

if (!IS_DRY_RUN && !IS_CI) {
  console.error('Refusing to run outside CI without --dry-run (would push to external repos).');
  process.exit(1);
}
if (!IS_DRY_RUN && !RELEASE_TOKEN) {
  console.error('RELEASE_TOKEN is required when not in --dry-run mode.');
  process.exit(1);
}

const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const COMMIT_MESSAGE = `chore: bump ${PKG_NAME} to ${PKG_VERSION}`;

/** dash/underscore -> PascalCase, e.g. batch-exec-cli -> BatchExecCli */
function pascalCase(name) {
  return name
    .split(/[-_.]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function getTarballUrl() {
  return `${NPM_REGISTRY}/${PKG_NAME}/-/${PKG_NAME}-${PKG_VERSION}.tgz`;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'user-agent': 'batch-exec-cli-publish' } }, res => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

/**
 * npm anonymous reads may hit async-replicated CDN nodes, so poll with
 * exponential backoff until the tarball is available or the budget runs out.
 */
async function downloadSha256Once(url, budgetMs) {
  const started = Date.now();
  let attempt = 1;
  for (;;) {
    try {
      const body = await fetchBuffer(url);
      return createHash('sha256').update(body).digest('hex');
    } catch (error) {
      const elapsed = Date.now() - started;
      if (elapsed >= budgetMs) {
        throw new Error(`Registry tarball not available after ${elapsed}ms: ${error.message}`);
      }
      const delay = Math.min(250 * 2 ** (attempt - 1), 5000);
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

function renderHomebrewFormula(sha256) {
  const className = pascalCase(PKG_NAME); // BatchExecCli
  const version = PKG_VERSION.replace(/^v/, '');
  return `class ${className} < Formula
  desc "${PKG_DESC}"
  homepage "${HOMEPAGE}"
  url "${getTarballUrl()}"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match "#{version}", shell_output("#{bin}/batch-exec --version")
  end
end
`;
}

function renderScoopManifest(sha256) {
  return {
    version: PKG_VERSION,
    description: PKG_DESC,
    homepage: HOMEPAGE,
    license: 'MIT',
    depends: 'nodejs-lts',
    url: getTarballUrl(),
    hash: sha256,
    extract_dir: 'package',
    installer: {
      script: 'npm install --omit=dev --ignore-scripts --prefix "$dir"'
    },
    bin: [['bin/batch-exec.cmd', 'batch-exec']],
    checkver: {
      github: `https://github.com/${GITHUB_OWNER}/batch-exec-cli`,
      regex: 'v([\\d.]+)'
    },
    autoupdate: {
      url: `${NPM_REGISTRY}/${PKG_NAME}/-/${PKG_NAME}-$version.tgz`
    }
  };
}

async function computeSha256() {
  try {
    return await downloadSha256Once(getTarballUrl(), MAX_REGISTRY_WAIT_MS);
  } catch (error) {
    if (IS_DRY_RUN) {
      console.warn(`[dry-run] sha256 fetch skipped: ${error.message}`);
      return 'DRY_RUN_PLACEHOLDER_SHA256';
    }
    throw error;
  }
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

/**
 * Update one external repo with the rendered artifact. Returns whether a push
 * happened (skips when the file is already up to date).
 */
function syncExternalRepo(repo, filename, content) {
  const cloneDir = mkdtempSync(path.join(tmpdir(), `${repo.split('/')[1]}-`));
  try {
    const cloneUrl = `https://x-access-token:${RELEASE_TOKEN}@github.com/${repo}.git` + (IS_DRY_RUN ? '' : '');
    if (IS_DRY_RUN) {
      console.log(`\n[dry-run] would clone & push ${repo}/${filename}`);
      console.log(content);
      return;
    }
    git(cloneDir, ['clone', '--depth', '1', cloneUrl, '.']);
    git(cloneDir, ['config', 'user.name', BOT_NAME]);
    git(cloneDir, ['config', 'user.email', BOT_EMAIL]);
    writeFileSync(path.join(cloneDir, filename), content);

    const changed = git(cloneDir, ['status', '--porcelain']);
    if (!changed) {
      console.log(`[skip] ${repo}/${filename} already up to date (v${PKG_VERSION})`);
      return;
    }
    git(cloneDir, ['add', filename]);
    git(cloneDir, ['commit', '-m', COMMIT_MESSAGE]);
    git(cloneDir, ['push', 'origin', 'HEAD']);
    console.log(`[ok] pushed ${repo}/${filename} (${COMMIT_MESSAGE})`);
  } finally {
    if (existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  if (IS_DRY_RUN) {
    console.log(`Dry run for ${PKG_NAME}@${PKG_VERSION}\n`);
  }
  const sha256 = await computeSha256();
  const formula = renderHomebrewFormula(sha256);
  const manifest = `${JSON.stringify(renderScoopManifest(sha256), null, 2)}\n`;

  syncExternalRepo(HOMEBREW_TAP_REPO, `${PKG_NAME}.rb`, formula);
  syncExternalRepo(SCOOP_BUCKET_REPO, `${PKG_NAME}.json`, manifest);

  if (IS_DRY_RUN) {
    console.log('\nDry run finished. No external repositories were modified.');
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
