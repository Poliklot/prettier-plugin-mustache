import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-plugin-mustache-install-'));
const projectRoot = path.join(tempRoot, 'project');
const prettierVersion = process.env.MUSTACHE_SMOKE_PRETTIER_VERSION || 'latest';
fs.mkdirSync(projectRoot, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }

  return result;
}

run('npm', ['pack', '--pack-destination', tempRoot], { stdio: 'inherit' });
const tarball = fs
  .readdirSync(tempRoot)
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => path.join(tempRoot, name))[0];

if (!tarball) {
  throw new Error('Could not find packed tarball');
}

fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"commonjs"}\n');
run('npm', ['install', `prettier@${prettierVersion}`, tarball], { cwd: projectRoot, stdio: 'inherit' });
fs.writeFileSync(path.join(projectRoot, 'sample.mst'), '{{#items}}\n<li>{{name}}</li>\n{{/items}}\n');

const verify = String.raw`
const assert = require('node:assert/strict');
const prettier = require('prettier');
const plugin = require('prettier-plugin-mustache');
const format = (source, options = {}) => prettier.format(source, { filepath: 'sample.mst', plugins: [plugin], ...options });
(async () => {
  assert.equal(
    await format('{{#items}}\n<li>{{name}}</li>\n{{/items}}', { tabWidth: 4 }),
    '{{#items}}\n    <li>{{ name }}</li>\n{{/items}}\n',
  );
  assert.equal(
    await format('{{#items}}\n<li>{{name}}</li>\n{{/items}}', { filepath: 'sample.mu', useTabs: true }),
    '{{#items}}\n\t<li>{{ name }}</li>\n{{/items}}\n',
  );
  const fixtures = [
    [
      '<script>\nconst result={"{{key}}":{a:1,b:2}};\n</script>\n',
      '<script>\n  const result = { "{{ key }}": { a: 1, b: 2 } };\n</script>\n',
    ],
    [
      '<style>\n.{{class}}{ {{property}}:{{color}};width:calc(({{expr}})*2); }\n</style>\n',
      '<style>\n  .{{ class }} {\n    {{ property }}: {{ color }};\n    width: calc(({{ expr }}) * 2);\n  }\n</style>\n',
    ],
  ];
  for (const [source, expected] of fixtures) {
    const formatted = await format(source);
    assert.equal(formatted, expected);
    assert.equal(await format(formatted), formatted);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

run(process.execPath, ['-e', verify], { cwd: projectRoot, stdio: 'inherit' });
if (process.env.MUSTACHE_SMOKE_FULL_TESTS === '1') {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `mustache@${manifest.devDependencies.mustache}`], {
    cwd: projectRoot, stdio: 'inherit',
  });
  const installedRoot = path.join(projectRoot, 'node_modules', manifest.name);
  fs.cpSync(path.join(repoRoot, 'test'), path.join(installedRoot, 'test'), { recursive: true });
  const tests = fs.readdirSync(path.join(installedRoot, 'test'))
    .filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('test', name));
  run(process.execPath, ['--test', ...tests], { cwd: installedRoot, stdio: 'inherit' });
}
console.log(`Install smoke passed with prettier@${prettierVersion}.`);
