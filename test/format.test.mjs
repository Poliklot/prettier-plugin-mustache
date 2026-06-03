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
  ];

  for (const sample of samples) {
    const once = await format(sample);
    assert.equal(await format(once), once);
  }
});
