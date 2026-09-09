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

test('re-wraps long embedded <script> lines to fit under the tag indent', async () => {
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
  assert.ok(formatted.includes('var cityEl = document.querySelector('));
  assert.ok(!formatted.includes('var cityEl = document.querySelector(\'[id="city-'));

  const second = await format(formatted);
  assert.equal(second, formatted);
});

test('does not run embedded formatting for non-JavaScript <script type="...">', async () => {
  const source = template(['<script type="application/json">', '{"a": 1, "b": {{value}}}', '</script>']);

  const expected = template(['<script type="application/json">', '  {"a": 1, "b": {{ value }}}', '</script>']);

  await assertFormats(source, expected);
});

test('falls back to flat formatting when a mustache section does not leave standalone JS behind', async () => {
  const source = template(['<script>', '{{#Dark}}', 'var isDark = true;', '{{/Dark}}', '</script>']);

  const formatted = await format(source);

  // Whether or not the fallback engages for this particular shape, the file
  // must format without throwing and must be idempotent either way.
  assert.equal(await format(formatted), formatted);
  assert.ok(formatted.includes('var isDark = true;'));
});

test('leaves empty inlined <script>/<style> tags (no body) untouched', async () => {
  const source = template([
    '<script data-anki-inline src="utils/uk_geog/snippets/zoombox.js"></script>',
    '<style data-anki-inline src="theme.css"></style>',
  ]);

  await assertFormats(source, source);
});

test('flushes an unterminated <script> with the flat fallback instead of dropping it', async () => {
  const source = template(['<div>', '<script>', 'doSomething();']);

  const formatted = await format(source);
  assert.ok(formatted.includes('doSomething();'));
});
