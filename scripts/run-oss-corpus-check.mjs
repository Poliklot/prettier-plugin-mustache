import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const corpusRoot = path.resolve(process.env.OSS_CORPUS_ROOT ?? path.join(os.tmpdir(), 'mustache-oss-corpus'));
const skipClone = process.env.OSS_CORPUS_SKIP_CLONE === '1' || process.argv.includes('--no-clone');

const repos = [
  {
    slug: 'janl/mustache.js',
    dir: 'mustache.js',
    roots: [['mustache.js']],
  },
  {
    slug: 'OpenAPITools/openapi-generator',
    dir: 'openapi-generator',
    sparse: [
      'modules/openapi-generator/src/main/resources',
      'modules/openapi-generator/src/test/resources',
    ],
    roots: [
      ['openapi-generator', 'modules', 'openapi-generator', 'src', 'main', 'resources'],
      ['openapi-generator', 'modules', 'openapi-generator', 'src', 'test', 'resources'],
    ],
  },
  {
    slug: 'swagger-api/swagger-codegen',
    dir: 'swagger-codegen',
    sparse: [
      'modules/swagger-codegen/src/main/resources',
      'modules/swagger-codegen/src/test/resources',
    ],
    roots: [
      ['swagger-codegen', 'modules', 'swagger-codegen', 'src', 'main', 'resources'],
      ['swagger-codegen', 'modules', 'swagger-codegen', 'src', 'test', 'resources'],
    ],
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function cloneMissingRepos() {
  fs.mkdirSync(corpusRoot, { recursive: true });

  for (const repo of repos) {
    const target = path.join(corpusRoot, repo.dir);

    if (fs.existsSync(target)) {
      console.log(`Using existing ${repo.slug} at ${target}`);
      continue;
    }

    if (skipClone) {
      throw new Error(`Missing ${target}. Re-run without --no-clone or set OSS_CORPUS_ROOT.`);
    }

    console.log(`Cloning ${repo.slug}...`);
    const cloneArgs = ['clone', '--depth', '1'];

    if (repo.sparse) {
      cloneArgs.push('--filter=blob:none', '--sparse');
    }

    cloneArgs.push(`https://github.com/${repo.slug}.git`, target);

    const clone = run('git', cloneArgs, { cwd: corpusRoot, stdio: 'inherit' });

    if (clone.status !== 0) {
      throw new Error(`Failed to clone ${repo.slug}`);
    }

    if (repo.sparse) {
      const sparse = run('git', ['-C', target, 'sparse-checkout', 'set', ...repo.sparse], {
        stdio: 'inherit',
      });

      if (sparse.status !== 0) {
        throw new Error(`Failed to configure sparse checkout for ${repo.slug}`);
      }
    }
  }
}

function resolveRoots() {
  const roots = [];

  for (const repo of repos) {
    for (const segments of repo.roots) {
      const root = path.join(corpusRoot, ...segments);

      if (fs.existsSync(root)) {
        roots.push(root);
      }
    }
  }

  if (roots.length === 0) {
    throw new Error(`No OSS corpus roots found under ${corpusRoot}`);
  }

  return roots;
}

function runCorpus(roots) {
  const result = run(process.execPath, [path.join(scriptDir, 'run-corpus-check.mjs'), ...roots], {
    cwd: repoRoot,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    throw new Error('OSS corpus check failed to run');
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    process.stdout.write(result.stdout);
    throw new Error(`Could not parse OSS corpus report: ${error.message}`);
  }
}

function flatten(report, key) {
  return report.repos.flatMap((repo) =>
    repo[key].map((item) => ({
      ...item,
      root: repo.root,
    })),
  );
}

function summarize(report) {
  const totals = report.repos.reduce(
    (sum, repo) => ({
      files: sum.files + repo.total,
      skipped: sum.skipped + repo.skippedCount,
      failed: sum.failed + repo.failedCount,
      changed: sum.changed + repo.changedCount,
      unchanged: sum.unchanged + repo.unchangedCount,
      nonIdempotent: sum.nonIdempotent + repo.nonIdempotentCount,
    }),
    { files: 0, skipped: 0, failed: 0, changed: 0, unchanged: 0, nonIdempotent: 0 },
  );

  const failed = flatten(report, 'failed');
  const nonIdempotent = flatten(report, 'nonIdempotent');

  console.log(
    `Mustache OSS corpus: ${totals.files} files, ${totals.skipped} skipped, ` +
      `${totals.failed} failures, ${totals.nonIdempotent} non-idempotent, ` +
      `${totals.changed} changed, ${totals.unchanged} unchanged`,
  );

  for (const repo of report.repos) {
    console.log(
      `- ${path.relative(corpusRoot, repo.root) || repo.root}: ${repo.total} files, ` +
        `${repo.failedCount} failures, ${repo.nonIdempotentCount} non-idempotent`,
    );
  }

  if (failed.length > 0 || nonIdempotent.length > 0) {
    console.error('\nProblems:');

    for (const item of [...failed, ...nonIdempotent].slice(0, 30)) {
      const kind = item.ok === false ? 'failed' : 'non-idempotent';
      console.error(`- ${kind}: ${item.filePath}`);
    }

    process.exit(1);
  }
}

cloneMissingRepos();
const roots = resolveRoots();
console.log(`\nOSS corpus root: ${corpusRoot}\n`);
const report = runCorpus(roots);
summarize(report);
console.log('\nOSS corpus check passed.');
