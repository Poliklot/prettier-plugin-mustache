import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

async function format(source) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
  });
}

test('formats variables and unescaped variables', async () => {
  assert.equal(
    await format('Hello {{name}}, {{{html}}}, {{& raw}}'),
    'Hello {{ name }}, {{{ html }}}, {{& raw }}\n',
  );
});

test('formats sections with nested tags', async () => {
  assert.equal(
    await format('{{#items}}<li>{{name}}</li>{{/items}}'),
    '{{#items}}\n  <li>{{ name }}</li>\n{{/items}}\n',
  );
});

test('formats inverted sections, comments, and partials', async () => {
  assert.equal(
    await format('{{^items}}{{!empty}}{{> empty_state}}{{/items}}'),
    '{{^items}}\n  {{! empty }}{{> empty_state }}\n{{/items}}\n',
  );
});

test('formats parent templates and block overrides', async () => {
  assert.equal(
    await format('{{< layout}}{{$title}}Hi{{/title}}{{/layout}}'),
    '{{< layout}}\n  {{$title}}\n    Hi\n  {{/title}}\n{{/layout}}\n',
  );
});

test('formats delimiter changes and custom delimiters', async () => {
  assert.equal(
    await format('{{=<% %>=}}Hello <%name%>'),
    '{{= <% %> =}}Hello <% name %>\n',
  );
});

test('preserves unmatched tags instead of throwing', async () => {
  assert.equal(await format('{{#items}}<li>{{name}}</li>'), '{{#items}}<li>{{name}}</li>\n');
});

test('is idempotent for representative templates', async () => {
  const samples = [
    'Hello {{name}}',
    '{{#items}}<li>{{name}}</li>{{/items}}',
    '{{< layout}}{{$title}}Hi{{/title}}{{/layout}}',
    '{{=<% %>=}}Hello <%name%>',
  ];

  for (const sample of samples) {
    const once = await format(sample);
    assert.equal(await format(once), once);
  }
});
