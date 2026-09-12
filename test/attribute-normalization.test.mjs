import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { resolveEmbeddedLanguage } from '../dist/source.js';

for (const whitespace of ['\t', '\n', '\f', '\r', ' ']) {
  test(`normalizes only edge HTML whitespace in type/lang: ${JSON.stringify(whitespace)}`, () => {
    const pad = (value) => `${whitespace}${value}${whitespace}`;
    assert.deepEqual(resolveEmbeddedLanguage('script', ` type="${pad('MoDuLe')}"`), { parser: 'babel', sourceType: 'module' });
    assert.deepEqual(resolveEmbeddedLanguage('script', ` lang="${pad('JaVaScRiPt')}"`), { parser: 'babel', sourceType: 'script' });
    assert.deepEqual(resolveEmbeddedLanguage('style', ` type="${pad('TeXt/CsS')}" lang="${pad('CsS')}"`), { parser: 'css' });
    assert.equal(resolveEmbeddedLanguage('script', ` type="mod${whitespace}ule"`), null);
    assert.equal(resolveEmbeddedLanguage('style', ` lang="c${whitespace}ss"`), null);
  });
}

for (const whitespace of ['\u000b', '\u0085', '\u00a0', '\u2003', '\ufeff']) {
  test(`does not trim non-HTML whitespace from type/lang: ${JSON.stringify(whitespace)}`, () => {
    for (const [tag, attribute, value] of [['script', 'type', 'module'], ['script', 'lang', 'js'], ['style', 'type', 'text/css'], ['style', 'lang', 'css']]) {
      for (const padded of [`${whitespace}${value}`, `${value}${whitespace}`, ` \t${whitespace}${value}${whitespace}\r `]) {
        assert.equal(resolveEmbeddedLanguage(tag, ` ${attribute}="${padded}"`), null);
      }
    }
  });
}

test('retains empty/whitespace-only attribute and legacy language behavior', () => {
  assert.deepEqual(resolveEmbeddedLanguage('script', ' type=""'), { parser: 'babel', sourceType: 'script' });
  assert.equal(resolveEmbeddedLanguage('script', ' type=" \t\n\f\r "'), null);
  assert.equal(resolveEmbeddedLanguage('style', ' type=" \t\n\f\r "'), null);
  assert.deepEqual(resolveEmbeddedLanguage('script', ' lang=" \t\n\f\r "'), { parser: 'babel', sourceType: 'script' });
  assert.deepEqual(resolveEmbeddedLanguage('style', ' lang=" \t\n\f\r "'), { parser: 'css' });
  assert.equal(resolveEmbeddedLanguage('script', ' language=" JavaScript "'), null);
  assert.deepEqual(resolveEmbeddedLanguage('script', ' language="VBScript" type="module"'), { parser: 'babel', sourceType: 'module' });
  assert.equal(resolveEmbeddedLanguage('script', ' type="unknown" type="module"'), null);
});

test('large type/lang attributes finish without quadratic whitespace backtracking', () => {
  // A separate process is essential: a test-runner timeout cannot interrupt a
  // synchronous regexp blocking its own event loop. The generous deadline is a
  // runaway-regression guard, not a microbenchmark or a timing-ratio assertion.
  const sourceModule = new URL('../dist/source.js', import.meta.url).href;
  const pluginModule = new URL('../dist/plugin.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import prettier from 'prettier';
    import * as plugin from ${JSON.stringify(pluginModule)};
    import { resolveEmbeddedLanguage } from ${JSON.stringify(sourceModule)};
    const padding = '\\t'.repeat(250_000);
    const interior = 'x' + padding + 'x';
    for (const tag of ['script', 'style']) {
      for (const name of ['type', 'lang']) {
        const attrs = ' ' + name + '="' + interior + '"';
        assert.equal(resolveEmbeddedLanguage(tag, attrs), null);
        const source = '<' + tag + attrs + '>\\n  {{value}}  \\n</' + tag + '>\\n';
        const options = { parser: 'mustache', plugins: [plugin] };
        const once = await prettier.format(source, options);
        assert.equal(once, source);
        assert.equal(await prettier.format(once, options), once);
      }
    }
    assert.deepEqual(resolveEmbeddedLanguage('script', ' type="' + padding + 'MODULE' + padding + '"'), { parser: 'babel', sourceType: 'module' });
    assert.deepEqual(resolveEmbeddedLanguage('style', ' lang="' + padding + 'CSS' + padding + '"'), { parser: 'css' });
    assert.equal(resolveEmbeddedLanguage('script', ' type="' + padding + '"'), null);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined, `Attribute regression child failed: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr || `Child exited with signal ${result.signal}`);
});
