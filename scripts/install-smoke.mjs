import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-plugin-mustache-install-'));
const projectRoot = path.join(tempRoot, 'project');
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

const pack = run('npm', ['pack', '--pack-destination', tempRoot], { stdio: 'inherit' });
const tarball = fs
  .readdirSync(tempRoot)
  .filter((name) => name.endsWith('.tgz'))
  .map((name) => path.join(tempRoot, name))[0];

if (!tarball) {
  throw new Error('Could not find packed tarball');
}

fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"commonjs"}\n');
run('npm', ['install', 'prettier', tarball], { cwd: projectRoot, stdio: 'inherit' });
fs.writeFileSync(path.join(projectRoot, 'sample.mst'), '{{#items}}\n<li>{{name}}</li>\n{{/items}}\n');

const verify = `
const prettier = require('prettier');
const plugin = require('prettier-plugin-mustache');
Promise.all([
  prettier.format('{{#items}}\\n<li>{{name}}</li>\\n{{/items}}', { filepath: 'sample.mst', plugins: [plugin], tabWidth: 4 }),
  prettier.format('{{#items}}\\n<li>{{name}}</li>\\n{{/items}}', { filepath: 'sample.mu', plugins: [plugin], useTabs: true }),
]).then(([spaces, tabs]) => {
  if (spaces !== '{{#items}}\\n    <li>{{ name }}</li>\\n{{/items}}\\n') process.exit(1);
  if (tabs !== '{{#items}}\\n\\t<li>{{ name }}</li>\\n{{/items}}\\n') process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

run(process.execPath, ['-e', verify], { cwd: projectRoot, stdio: 'inherit' });
console.log('Install smoke passed with prettier@latest.');
