import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

function template(lines) {
  return `${lines.join('\n')}\n`;
}

async function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
    ...options,
  });
}

async function assertFormats(source, expected, options = {}) {
  assert.equal(await format(source, options), expected);
  assert.equal(await format(expected, options), expected);
}

test('formats <script> bodies with the babel printer and indents relative to the tag', async () => {
  const source = template([
    '<div class="center">',
    '<script>',
    'setupZoombox({',
    'mapId: "map",',
    'targetId: "county-{{County}}",',
    '});',
    '</script>',
    '</div>',
  ]);

  const expected = template([
    '<div class="center">',
    '  <script>',
    '    setupZoombox({',
    '      mapId: "map",',
    '      targetId: "county-{{ County }}",',
    '    });',
    '  </script>',
    '</div>',
  ]);

  await assertFormats(source, expected);
});

test('formats <style> bodies with the css printer and indents relative to the tag', async () => {
  const source = template(['<style>', '[id="county-{{County}}"] {', 'fill: #d00;', 'stroke:#000;', '}', '</style>']);

  const expected = template(['<style>', '  [id="county-{{ County }}"] {', '    fill: #d00;', '    stroke: #000;', '  }', '</style>']);

  await assertFormats(source, expected);
});

test('respects tabWidth/useTabs for embedded <script>/<style> content', async () => {
  const source = template(['<script>', 'var x = {a: 1, b: 2};', '</script>']);

  assert.equal(
    await format(source, { tabWidth: 4 }),
    template(['<script>', '    var x = { a: 1, b: 2 };', '</script>']),
  );

  assert.equal(await format(source, { useTabs: true }), template(['<script>', '\tvar x = { a: 1, b: 2 };', '</script>']));
});

test('bases wrapping decisions on the restored line width, not the placeholder width', async () => {
  // This line is short enough to fit on one line once `{{City}}` is back in
  // place, but a fixed-length placeholder (e.g. `__PRETTIER_MUSTACHE_0__`,
  // longer than `{{City}}`) would push it over printWidth and force an
  // unwanted wrap that the restored output doesn't actually need.
  const source = template([
    '<div>',
    '  <div>',
    '    <script>',
    '      var cityEl = document.querySelector(\'[id="city-{{City}}"]\');',
    '    </script>',
    '  </div>',
    '</div>',
  ]);

  const formatted = await format(source);
  assert.ok(formatted.includes('var cityEl = document.querySelector(\'[id="city-{{ City }}"]\');'));

  const second = await format(formatted);
  assert.equal(second, formatted);
});

test('still wraps a line that is genuinely too long once restored', async () => {
  const source = template([
    '<script>',
    'var cityGroup = document.querySelector(\'[id="a-very-long-selector-that-does-not-fit-{{City}}"]\');',
    '</script>',
  ]);

  const formatted = await format(source);
  assert.ok(formatted.includes('var cityGroup = document.querySelector(\n'));

  const second = await format(formatted);
  assert.equal(second, formatted);
});

test('does not run embedded formatting for non-JavaScript <script type="...">', async () => {
  const source = template(['<script type="application/json">', '{"a": 1, "b": {{value}}}', '</script>']);

  const expected = template(['<script type="application/json">', '  {"a": 1, "b": {{ value }}}', '</script>']);

  await assertFormats(source, expected);
});

test('never substitutes section/comment/partial tags - falls back to flat formatting instead', async () => {
  // {{#Dark}}/{{/Dark}} are structural, not a value - swapping them for a
  // placeholder would change what the braces around them mean, so this
  // should always take the flat fallback rather than gamble on babel
  // accepting the substituted text.
  const source = template(['<script>', '{{#Dark}}', 'var isDark = true;', '{{/Dark}}', '</script>']);

  const expected = template(['<script>', '  {{#Dark}}', '  var isDark = true;', '  {{/Dark}}', '</script>']);

  await assertFormats(source, expected);
});

test('leaves empty inlined <script>/<style> tags (no body) untouched', async () => {
  const source = template([
    '<script data-anki-inline src="utils/uk_geog/snippets/zoombox.js"></script>',
    '<style data-anki-inline src="theme.css"></style>',
  ]);

  await assertFormats(source, source);
});

test('does not format a <script src="..."> body (browsers ignore it anyway)', async () => {
  const source = template(['<script src="app.js">', 'this is not actually run', '</script>']);

  const expected = template(['<script src="app.js">', '  this is not actually run', '</script>']);

  await assertFormats(source, expected);
});

test('respects embeddedLanguageFormatting: "off"', async () => {
  const source = template(['<script>', 'var x = {a: 1};', '</script>']);

  const expected = template(['<script>', '  var x = {a: 1};', '</script>']);

  assert.equal(await format(source, { embeddedLanguageFormatting: 'off' }), expected);
});

test('flushes an unterminated <script> with the flat fallback instead of dropping it', async () => {
  const source = template(['<div>', '<script>', 'doSomething();']);

  const formatted = await format(source);
  assert.ok(formatted.includes('doSomething();'));
});

test('does not compound indentation on a multi-line block comment across repeated passes', async () => {
  // babel reformats a block comment's opening line but preserves its
  // continuation lines exactly as given (including their original
  // whitespace). Adding indentPrefix to every output line unconditionally
  // used to stack an extra prefix onto those continuation lines on every
  // format pass. Found via `npm run corpus:oss` (a real OpenAPI Generator
  // template bundling webpack's style-loader boilerplate).
  const source = template([
    '<div>',
    '  <script>',
    '    /*',
    '    \t\tMIT License',
    '    \t\tAuthor Tobias Koppers @sokra',
    '    \t*/',
    '    var x = 1;',
    '  </script>',
    '</div>',
  ]);

  const once = await format(source);
  const twice = await format(once);
  const thrice = await format(twice);
  assert.equal(twice, once);
  assert.equal(thrice, once);
});

test('does not indent continuation lines of a multi-line template literal', async () => {
  const source = template(['<script>', 'var s = `line one', 'line two`;', '</script>']);

  const once = await format(source);
  const twice = await format(once);
  assert.equal(twice, once);
  assert.ok(once.includes('line one\nline two`;'));
});
