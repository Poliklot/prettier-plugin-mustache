import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import mustache from 'mustache';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

function template(lines) {
  return `${lines.join('\n')}\n`;
}

function script(body) {
  return template(['<script>', body, '</script>']);
}

async function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
    ...options,
  });
}

function scriptBody(source) {
  const match = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'The formatted fixture must retain its script element');
  return match[1];
}

function renderedResult(source, view = {}) {
  const body = scriptBody(mustache.render(source, view));
  // Execute only these fixed test fixtures. Serialize inside the VM so
  // object assertions do not depend on prototypes from different realms.
  const serialized = vm.runInNewContext(`${body}\nJSON.stringify(result)`, {}, { timeout: 1000 });
  return JSON.parse(serialized);
}

async function assertStable(source, options = {}) {
  const once = await format(source, options);
  const twice = await format(once, options);
  const thrice = await format(twice, options);
  assert.equal(twice, once, 'Formatting must be idempotent on the second pass');
  assert.equal(thrice, once, 'Formatting must remain idempotent on the third pass');
  return once;
}

async function assertRenderedResult(source, view, expected) {
  assert.deepEqual(renderedResult(source, view), expected, 'The source fixture must produce the expected value');
  const formatted = await assertStable(source);
  assert.deepEqual(renderedResult(formatted, view), expected, 'Formatting must preserve the rendered JavaScript result');
}

test('embedded regression: preserves quotes around dynamic JavaScript property keys', async () => {
  // An identifier-shaped placeholder must not make a dynamic key eligible
  // for quote removal: its rendered value may contain a hyphen or spaces.
  const source = script('const result = { "{{key}}": 1 };');

  await assertRenderedResult(source, { key: 'foo-bar' }, { 'foo-bar': 1 });
});

test('embedded regression: preserves grouping around unescaped JavaScript expressions', async () => {
  // Mustache values are not guaranteed to be atomic JavaScript expressions.
  // Removing these parentheses would change (1 + 2) * 2 from 6 to 5.
  const source = script('const result = ({{{expr}}}) * 2;');

  await assertRenderedResult(source, { expr: '1 + 2' }, 6);
});

test('embedded regression: restores Mustache tokens used as CSS property names', async () => {
  const source = template(['<style>', 'a { {{property}}: red; }', '</style>']);
  const formatted = await assertStable(source);
  const rendered = mustache.render(formatted, { property: 'color' });

  // CSS may normalize a property's spelling, including placeholder case.
  // Check the actual rendered declaration rather than a particular sentinel.
  assert.match(rendered, /\bcolor:\s*red\s*;/);
});

test('embedded regression: does not replace source text that matches a placeholder', async () => {
  const source = script('const result = "__M0___/{{x}}";');

  await assertRenderedResult(source, { x: 'ok' }, '__M0___/ok');
});

// These continuation lines already have the legacy formatter's two-space
// indentation. Both the base implementation and a safe embedded formatter
// must preserve their values, not add another prefix on every format pass.
const literalCases = [
  {
    name: 'nested template literals',
    body: 'const result = `outer ${`inner\n  text`} end`;',
    expected: 'outer inner\n  text end',
  },
  {
    name: 'braces inside template interpolation strings',
    body: 'const result = `${"{"}\n  text`;',
    expected: '{\n  text',
  },
  {
    name: 'escaped newlines inside template literals',
    body: 'const result = `first\\\n  text`;',
    expected: 'first  text',
  },
];

for (const { name, body, expected } of literalCases) {
  test(`embedded regression: preserves values and idempotence for ${name}`, async () => {
    await assertRenderedResult(script(body), {}, expected);
  });
}

test('embedded regression: preserves JSON with an unquoted script type attribute', async () => {
  const source = template(['<script type=application/json>', '[1,2]', '</script>']);
  const formatted = await assertStable(source);

  // Babel accepts an array as an expression but adds a semicolon, which is
  // invalid in a JSON data block. The unquoted type is valid HTML syntax.
  assert.deepEqual(JSON.parse(scriptBody(formatted)), [1, 2]);
});

test('embedded regression: respects JavaScript quote, semicolon, and arrow options', async () => {
  const source = script("const result = x => 'hello'");
  const formatted = await assertStable(source, {
    semi: false,
    singleQuote: true,
    arrowParens: 'avoid',
  });

  assert.equal(scriptBody(formatted).trim(), "const result = x => 'hello'");
});

test('embedded regression: resumes HTML formatting after a non-standalone script close', async () => {
  const source = template(['<div>', '<script>', 'const x = 1;</script>', '<p>Hi</p>', '</div>']);
  const formatted = await assertStable(source);

  // This closing shape is outside embedded formatting's declared scope;
  // it must not make subsequent HTML part of an unterminated script body.
  assert.match(formatted, /\n  <p>Hi<\/p>\n<\/div>\n$/);
});
