import assert from 'node:assert/strict';
import { test } from 'node:test';
import engine from 'mustache';
import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';

// HTML proof collapses only browser-collapsible ASCII whitespace, not NBSP or
// other Unicode data. Plain templates and lambda bodies are compared exactly.
const htmlText = (s) => s.replace(/<\/?(?:p|span|div|b)>/g, '').replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
const optionsMatrix = [
  { printWidth: 80 }, { printWidth: 20 },
  { printWidth: 120, htmlWhitespaceSensitivity: 'strict' },
  { printWidth: 80, useTabs: true, tabWidth: 4, embeddedLanguageFormatting: 'off' },
];
const view = {
  a: 'A', b: 'B', x: 3, n: 10, ok: true, html: '<b>ok</b>',
  'first  name': 'DOUBLE', 'first name': 'SINGLE', 'foo ( bar )': 'ORIGINAL',
  'foo (bar)': 'CHANGED', 'x as |y|': 'KEY',
};
const render = (s, data = view) => engine.render(s, data, { part: 'P', multiline: 'X\nY\n' });
async function prove(source, html = false, data = view) {
  const before = render(source, data);
  for (const options of optionsMatrix) {
    const once = await prettier.format(source, { parser: 'mustache', plugins: [plugin], ...options });
    const after = render(once, data);
    assert.equal(html ? htmlText(after) : after, html ? htmlText(before) : before, JSON.stringify({ source, options, once }));
    assert.equal(await prettier.format(once, { parser: 'mustache', plugins: [plugin], ...options }), once);
  }
}
const nodes = ['{{a}}', '<b>{{b}}</b>', '{{! note}}', '{{#ok}}K{{/ok}}', '{{>part}}', '{{{html}}}', '{{&html}}'];
for (const wrapper of ['', 'p', 'span', 'div']) {
  test(`source boundaries preserve execution in ${wrapper || 'plain text'}`, async () => {
    for (const left of nodes) for (const right of nodes) for (const gap of ['', ' ', '\n', '\u00a0', '\u202f']) {
      const text = `${left}${gap}${right}`;
      await prove(wrapper ? `<${wrapper}>${text}</${wrapper}>\n` : `${text}\n`, Boolean(wrapper));
    }
  });
}
for (const source of [
  '<p>X<span> Y </span>Z</p>\n', '<p>X<span> </span>Z</p>\n',
  '<p>A\u00a0B</p>\n', '<p>{{a}}\u202f{{b}}</p>\n',
  '<p>X<span>\u00a0</span>Z</p>\n', '<span>\u00a0{{a}}\u00a0</span>\n',
]) test(`HTML data and inline edges: ${JSON.stringify(source)}`, () => prove(source, true));
for (const source of ['A\u00a0\n', 'A\u202f\n', 'Before\n  {{a}}\nAfter\n']) {
  test(`literal template data: ${JSON.stringify(source)}`, () => prove(source));
}
for (const source of [
  '{{first  name}}\n', '{{foo ( bar )}}\n', '{{x as |y|}}\n',
  '{{#first name}}OK{{/first name}}\n',
  '{{=<% %>=}}<%a%><%b%>\n', '{{=<% %>=}}<%&html%>\n',
]) test(`Mustache names and delimiters: ${JSON.stringify(source)}`, () => prove(source));
test('callable sections receive exactly the original body, including nested tags and delimiters', async () => {
  for (const source of [
    '{{#lambda}}{{a}}{{/lambda}}\n',
    '{{#lambda}}\n  {{a}}  \n{{#ok}}{{b}}{{/ok}}\n{{/lambda}}\n',
    '<div>{{#lambda}}<b>{{a}}</b>{{/lambda}}</div>\n',
    '{{#lambda}}{{=<% %>=}}<%a%><%/lambda%>\n<p><%b%></p>\n',
  ]) {
    const seen = [];
    const data = { ...view, lambda: () => text => { seen.push(text); return JSON.stringify(text); } };
    await prove(source, false, data);
    assert.ok(seen.every(text => text === seen[0]));
  }
});

for (const source of ['  {{>multiline}}\n', '<div>\n  {{>multiline}}\n</div>\n', '<div>\n      {{>multiline}}\n</div>\n']) {
  test(`standalone partial indentation is runtime data: ${JSON.stringify(source)}`, () => prove(source));
}
