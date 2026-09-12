import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import mustache from 'mustache';
import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';

const format = (source, options = {}) => prettier.format(source, { parser: 'mustache', plugins: [plugin], ...options });
const bodyOf = (source, tag = 'script') => source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i'))[1];
async function stable(source, options = {}) {
  const once = await format(source, options);
  const twice = await format(once, options);
  assert.equal(twice, once);
  assert.equal(await format(twice, options), once);
  return once;
}

for (const options of [{ embeddedLanguageFormatting: 'off' }, { embeddedLanguageFormatting: 'off', useTabs: true, tabWidth: 4 }]) {
  for (const body of [
    '\nconst result = `first  \n    second\n\tthird`;\n   ',
    '\nconst result = "first\\\n    second";  \n\n\t ',
    '\nconst result = `outer ${`inner\n  text`} end`;\n ',
    '  \n\nconst result=1;\n\n\t',
  ]) {
    test(`disabled embedding retains raw whitespace and JS values: ${JSON.stringify({ body, options })}`, async () => {
      const source = `<div>\n<script>${body}</script>\n<p>{{label}}</p>\n</div>\n`;
      const output = await stable(source, options);
      assert.equal(bodyOf(output), body);
      const evaluate = (text) => vm.runInNewContext(`${bodyOf(text)}\nJSON.stringify(result)`);
      assert.equal(evaluate(output), evaluate(source));
      assert.ok(output.includes('<p>{{ label }}</p>'));
    });
  }
}

for (const body of [
  '\nconst result=`first  \n    {{value}}`;\n  ',
  '\nconst result="first\\\n    {{value}}";\n  ',
  '\n{{#enabled}}\nconst result=`first\n    second`;\n{{/enabled}}\n\t',
  '\nconst result=({{&expression}});\nconst untouched=`first\n    second`;\n',
]) {
  test(`unsupported dynamic JS preserves its entire source: ${JSON.stringify(body)}`, async () => {
    const source = `<script>${body}</script>\n`;
    const output = await stable(source);
    assert.equal(bodyOf(output), body);
    const view = { value: 'foo-bar', enabled: true, expression: '1 + 2' };
    const evaluate = (text) => vm.runInNewContext(`${bodyOf(mustache.render(text, view))}\nJSON.stringify(result)`);
    assert.equal(evaluate(output), evaluate(source));
  });
}

test('preserves lambda input, delimiter spelling and following delimiter state in fallback', async () => {
  const source = '<script>\n{{#lambda}}\n  {{value}}  \n{{/lambda}}\n{{=<% %>=}}\n  <%value%>\n </script>\n<p><%value%></p>\n';
  const seen = [];
  const view = { value: 'hello', lambda: () => (text, render) => { seen.push(text); return render(text); } };
  const output = await stable(source);
  assert.equal(bodyOf(output), bodyOf(source));
  mustache.render(source, view);
  mustache.render(output, view);
  assert.equal(seen[1], seen[0]);
  assert.ok(output.includes('<p><% value %></p>'));
});

for (const [tag, attrs, body] of [
  ['script', ' type="text/plain"', '\n    first  \n\t second\n  '],
  ['script', ' type=application/json', '\n  {"value":{{value}}}  \n '],
  ['style', ' lang=scss', '\n  $value: "first\\\n    second";\n '],
  ['style', '', '\n a::after {content:"first\\\n    {{value}}";}\n '],
  ['script', '', '\n const broken = ;  \n  {{value}}\n '],
  ['script', '', '\n   \n\t '],
]) {
  test(`preserves opaque or empty ${tag} content ${attrs}: ${JSON.stringify(body)}`, async () => {
    const source = `<div>\n<${tag}${attrs}>${body}</${tag}>\n</div>\n`;
    const output = await stable(source);
    assert.equal(bodyOf(output, tag), body);
  });
}

test('failed delegated parsing retains exact original source, not normalized placeholders', async () => {
  const { parsers } = await import('prettier/plugins/babel');
  const failing = { parsers: { babel: { ...parsers.babel, parse() { throw new Error('test failure'); } } } };
  const source = '<script> \n  const result="{{value}}";  \n\n  </script>\n';
  assert.equal(bodyOf(await stable(source, { plugins: [plugin, failing] })), bodyOf(source));
});

for (const endOfLine of ['lf', 'crlf', 'cr', 'auto']) {
  test(`verbatim fallback only normalizes configured line endings: ${endOfLine}`, async () => {
    const source = '<script>\r\n  const result=`first  \r\n    {{value}}`;\r\n\t</script>\r\n';
    const output = await stable(source, { endOfLine });
    const eol = endOfLine === 'cr' ? '\r' : endOfLine === 'lf' ? '\n' : '\r\n';
    assert.equal(bodyOf(output), bodyOf(source).replaceAll('\r\n', eol));
  });
}
