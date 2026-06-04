import assert from 'node:assert/strict';
import { test } from 'node:test';
import mustache from 'mustache';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

const cases = [
  {
    name: 'interpolation and dotted names',
    source: 'Hello {{user.name}} {{.}} {{{html}}} {{& html}}',
    view: { user: { name: 'Ada' }, '.': 'ignored', html: '<strong>ok</strong>' },
  },
  {
    name: 'inline sections preserve render output',
    source: '{{#items}}<li>{{name}}</li>{{/items}}',
    view: { items: [{ name: 'One' }, { name: 'Two' }] },
  },
  {
    name: 'inline inverted sections preserve render output',
    source: '{{^items}}No items{{/items}}',
    view: { items: [] },
  },
  {
    name: 'inline comments preserve render output',
    source: 'A{{! ignored}}B {{name}}',
    view: { name: 'Ada' },
  },
  {
    name: 'partials preserve render output',
    source: 'Users:{{#items}}{{> row}}{{/items}}',
    view: { items: [{ name: 'Ada' }, { name: 'Grace' }] },
    partials: { row: '<{{name}}>' },
  },
  {
    name: 'delimiter changes preserve render output',
    source: '{{=<% %>=}}Hello <%name%> <%={{ }}=%> {{again}}',
    view: { name: 'Ada', again: 'Grace' },
  },
];

function trimFinalNewline(value) {
  return value.replace(/\n$/, '');
}

for (const item of cases) {
  test(`render-equivalent: ${item.name}`, async () => {
    const formatted = await prettier.format(item.source, {
      parser: 'mustache',
      plugins: [plugin],
    });

    const before = mustache.render(item.source, item.view, item.partials);
    const after = mustache.render(formatted, item.view, item.partials);

    assert.equal(trimFinalNewline(after), trimFinalNewline(before));
    assert.equal(
      await prettier.format(formatted, {
        parser: 'mustache',
        plugins: [plugin],
      }),
      formatted,
    );
  });
}
