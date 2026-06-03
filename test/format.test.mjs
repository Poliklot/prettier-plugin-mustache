import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

async function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
    ...options,
  });
}

async function formatByFilepath(source, filepath) {
  return prettier.format(source, {
    filepath,
    plugins: [plugin],
  });
}

test('infers parser for common Mustache file extensions', async () => {
  assert.equal(await formatByFilepath('{{name}}', 'view.mustache'), '{{ name }}\n');
  assert.equal(await formatByFilepath('{{name}}', 'view.mst'), '{{ name }}\n');
  assert.equal(await formatByFilepath('{{name}}', 'view.mu'), '{{ name }}\n');
});

test('respects tabWidth and useTabs for multiline section indentation', async () => {
  assert.equal(
    await format('{{#items}}\n<li>{{name}}</li>\n{{/items}}', { tabWidth: 4 }),
    '{{#items}}\n    <li>{{ name }}</li>\n{{/items}}\n',
  );

  assert.equal(
    await format('{{#items}}\n<li>{{name}}</li>\n{{/items}}', { useTabs: true }),
    '{{#items}}\n\t<li>{{ name }}</li>\n{{/items}}\n',
  );
});

test('formats standalone comments, partials, and delimiter tags inside sections', async () => {
  assert.equal(
    await format('{{#names}}\n{{! comment}}\n{{> user}}\n{{/names}}', { tabWidth: 4 }),
    '{{#names}}\n    {{! comment }}\n    {{> user }}\n{{/names}}\n',
  );

  assert.equal(
    await format('{{#section}}\n{{=<% %>=}}\n<%name%>\n<%/section%>'),
    '{{#section}}\n  {{= <% %> =}}\n  <% name %>\n<%/section%>\n',
  );
});

test('formats section keys that use Mustache-valid punctuation', async () => {
  assert.equal(
    await format('{{#person?}}\nHi {{name}}!\n{{/person?}}'),
    '{{#person?}}\n  Hi {{ name }}!\n{{/person?}}\n',
  );
});

test('formats interpolation, dotted names, implicit iterators, and unescaped variables', async () => {
  assert.equal(
    await format('Hello {{name.first}} {{.}}, {{{html}}}, {{& raw}}'),
    'Hello {{ name.first }} {{ . }}, {{{ html }}}, {{& raw }}\n',
  );
});

test('preserves inline sections to avoid Mustache whitespace changes', async () => {
  assert.equal(
    await format('{{#items}}<li>{{name}}</li>{{/items}}'),
    '{{#items}}<li>{{ name }}</li>{{/items}}\n',
  );
});

test('formats multiline sections with nested tags', async () => {
  assert.equal(
    await format('{{#items}}\n<li>{{name}}</li>\n{{/items}}'),
    '{{#items}}\n  <li>{{ name }}</li>\n{{/items}}\n',
  );
});

test('formats inverted sections, comments, and partials', async () => {
  assert.equal(
    await format('{{^items}}{{!empty}}{{> empty_state}}{{/items}}'),
    '{{^items}}{{! empty }}{{> empty_state }}{{/items}}\n',
  );
});

test('formats multiline comments without crashing', async () => {
  assert.equal(
    await format('Before {{! first\nsecond }} After'),
    'Before {{! first\nsecond }} After\n',
  );
});

test('formats parent templates and block overrides', async () => {
  assert.equal(
    await format('{{< layout}}\n{{$title}}Hi{{/title}}\n{{/layout}}'),
    '{{< layout}}\n  {{$title}}Hi{{/title}}\n{{/layout}}\n',
  );
});

test('formats dynamic partial and parent names', async () => {
  assert.equal(
    await format('{{>*partial}} {{<*layout}}{{$body}}{{.}}{{/body}}{{/*layout}}'),
    '{{> *partial }} {{< *layout}}{{$body}}{{ . }}{{/body}}{{/*layout}}\n',
  );
});

test('formats delimiter changes, resets, and custom delimiters inside sections', async () => {
  assert.equal(
    await format('{{=<% %>=}}Hello <%name%> <%={{ }}=%> {{again}}'),
    '{{= <% %> =}}Hello <% name %> <%= {{ }} =%> {{ again }}\n',
  );

  assert.equal(
    await format('{{#section}}{{=<% %>=}}<%name%><%/section%>'),
    '{{#section}}{{= <% %> =}}<% name %><%/section%>\n',
  );
});

test('preserves unmatched tags instead of throwing', async () => {
  assert.equal(await format('{{#items}}<li>{{name}}</li>'), '{{#items}}<li>{{name}}</li>\n');
  assert.equal(await format('{{/items}}'), '{{/items}}\n');
});

test('preserves leading root whitespace while normalizing final newline', async () => {
  assert.equal(await format('  {{name}}'), '  {{ name }}\n');
});

test('is idempotent for representative templates', async () => {
  const samples = [
    'Hello {{name}}',
    '{{#items}}<li>{{name}}</li>{{/items}}',
    '{{#items}}\n<li>{{name}}</li>\n{{/items}}',
    '{{< layout}}\n{{$title}}Hi{{/title}}\n{{/layout}}',
    '{{=<% %>=}}Hello <%name%> <%={{ }}=%> {{again}}',
    '{{>*partial}} {{<*layout}}{{$body}}{{.}}{{/body}}{{/*layout}}',
    '{{#names}}\n{{! comment}}\n{{> user}}\n{{/names}}',
    '{{#person?}}\nHi {{name}}!\n{{/person?}}',
  ];

  for (const sample of samples) {
    const once = await format(sample);
    assert.equal(await format(once), once);
  }
});
