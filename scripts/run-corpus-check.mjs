import fs from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';

const [, , ...roots] = process.argv;

if (roots.length === 0) {
  console.error('Usage: node scripts/run-corpus-check.mjs <root> [more-roots...]');
  process.exit(1);
}

const exts = new Set(['.mustache', '.mst', '.mu']);
const maxFileBytes = Number.parseInt(process.env.MUSTACHE_CORPUS_MAX_FILE_BYTES ?? '524288', 10);

function normalizeForCompare(text) {
  return text.replace(/\r\n?/g, '\n');
}

function countLines(text) {
  return text.length === 0 ? 0 : text.split('\n').length;
}

function countChangedLines(before, after) {
  const left = normalizeForCompare(before).split('\n');
  const right = normalizeForCompare(after).split('\n');
  const max = Math.max(left.length, right.length);
  let changed = 0;

  for (let index = 0; index < max; index += 1) {
    if ((left[index] ?? '') !== (right[index] ?? '')) {
      changed += 1;
    }
  }

  return changed;
}

async function listTemplateFiles(root) {
  const files = [];

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'vendor') {
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (exts.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function analyzeFile(filePath) {
  const stat = await fs.stat(filePath);

  if (stat.size > maxFileBytes) {
    return {
      filePath,
      ok: true,
      skipped: true,
      reason: `larger than ${maxFileBytes} bytes`,
    };
  }

  const source = await fs.readFile(filePath, 'utf8');
  const normalizedSource = normalizeForCompare(source);

  try {
    const formatted = await prettier.format(source, {
      parser: 'mustache',
      plugins: [plugin],
      printWidth: 80,
    });

    const secondPass = await prettier.format(formatted, {
      parser: 'mustache',
      plugins: [plugin],
      printWidth: 80,
    });

    const normalizedFormatted = normalizeForCompare(formatted);
    const changed = normalizedFormatted !== normalizedSource;
    const idempotent = secondPass === formatted;

    return {
      filePath,
      ok: true,
      skipped: false,
      changed,
      idempotent,
      sourceLines: countLines(normalizedSource),
      formattedLines: countLines(normalizedFormatted),
      lineDelta: countLines(normalizedFormatted) - countLines(normalizedSource),
      changedLines: changed ? countChangedLines(normalizedSource, normalizedFormatted) : 0,
    };
  } catch (error) {
    return {
      filePath,
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
  }
}

function summarizeRepo(root, results) {
  const total = results.length;
  const skipped = results.filter((item) => item.skipped);
  const failed = results.filter((item) => !item.ok);
  const changed = results.filter((item) => item.ok && !item.skipped && item.changed);
  const nonIdempotent = results.filter((item) => item.ok && !item.skipped && !item.idempotent);

  const topChanged = changed
    .slice()
    .sort((left, right) => {
      if (right.changedLines !== left.changedLines) {
        return right.changedLines - left.changedLines;
      }

      return Math.abs(right.lineDelta) - Math.abs(left.lineDelta);
    })
    .slice(0, 15)
    .map((item) => ({
      filePath: item.filePath,
      changedLines: item.changedLines,
      lineDelta: item.lineDelta,
      sourceLines: item.sourceLines,
      formattedLines: item.formattedLines,
    }));

  return {
    root,
    total,
    skippedCount: skipped.length,
    failedCount: failed.length,
    changedCount: changed.length,
    unchangedCount: total - skipped.length - failed.length - changed.length,
    nonIdempotentCount: nonIdempotent.length,
    failed,
    nonIdempotent,
    topChanged,
  };
}

const startedAt = new Date().toISOString();
const repos = [];

for (const root of roots) {
  const files = await listTemplateFiles(root);
  const results = [];

  for (const filePath of files) {
    results.push(await analyzeFile(filePath));
  }

  repos.push(summarizeRepo(root, results));
}

console.log(
  JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      maxFileBytes,
      repos,
    },
    null,
    2,
  ),
);
