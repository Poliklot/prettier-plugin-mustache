import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import mustache from 'mustache';
import prettier from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { parsers as cssParsers } from 'prettier/plugins/postcss';

const plugin = await import('../dist/plugin.js');
const template = (tag, body, attrs = '') => `<${tag}${attrs}>\n${body}\n</${tag}>\n`;
const format = (source, options = {}) => prettier.format(source, { parser: 'mustache', plugins: [plugin], ...options });

async function stable(source, options = {}) {
  const once = await format(source, options);
  assert.equal(await format(once, options), once);
  return once;
}

function result(source, view = {}) {
  // Extract only our fixed fixtures; this is not an HTML sanitizer.
  const body = mustache.render(source, view).match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i)[1];
  return vm.runInNewContext(`${body}\nJSON.stringify(result)`, {}, { timeout: 1000 });
}

test('retains rendered results with whitespace, case, or attributes in script end tags', async () => {
  for (const close of ['</script >', '</SCRIPT>', '</script data-fixture=end>']) {
    const source = `<script>\nconst result={"{{key}}":1};\n${close}\n`;
    assert.equal(result(await stable(source), { key: 'foo-bar' }), result(source, { key: 'foo-bar' }));
  }
});

test('print remains synchronous when embedding is disabled', () => {
  const source = template('script', 'const x={a:1};');
  const printed = plugin.printers['mustache-ast'].print(
    { getValue: () => ({ type: 'Program', source }) },
    { embeddedLanguageFormatting: 'off', tabWidth: 2, useTabs: false },
  );
  // Native printers return Docs, not necessarily strings. Keep the exact
  // output assertion while checking the synchronous contract explicitly.
  assert.equal(typeof printed?.then, 'undefined');
  assert.equal(prettier.doc.printer.printDocToString(printed, {
    printWidth: 80, tabWidth: 2, useTabs: false,
  }).formatted, template('script', '  const x={a:1};'));
});

test('formats safe dynamic JS property keys without removing quotes', async () => {
  const source = template('script', 'const result={"{{key}}":{a:1,b:2}};');
  const formatted = await stable(source, { quoteProps: 'as-needed' });
  assert.match(formatted, /const result = \{ "{{ key }}": \{ a: 1, b: 2 \} \};/);
  assert.equal(result(formatted, { key: 'foo-bar' }), result(source, { key: 'foo-bar' }));
});

for (const [name, body, view] of [
  ['plain expression', 'const result=({{expr}})*2;', { expr: '1 + 2' }],
  ['unescaped quoted value', "const result='{{&value}}';", { value: 'a"b' }],
  ['regular expression', 'const result=/{{pattern}}/.test("a");', { pattern: 'a' }],
  ['escape before a token', 'const result="\\{{key}}";', { key: 'n' }],
  ['dynamic string containing escapes', String.raw`const result='a\'{{x}}"';`, { x: '\\' }],
]) {
  test(`safely falls back for a ${name}`, async () => {
    const source = template('script', body);
    const formatted = await stable(source);
    assert.equal(result(formatted, view), result(source, view));
  });
}

for (const options of [{ tabWidth: 2 }, { tabWidth: 4 }, { tabWidth: 4, useTabs: true }]) {
  test(`preserves literal contents with ${JSON.stringify(options)}`, async () => {
    for (const body of [
      'const regex = /`/; const result = `first\ntext`;',
      'const result = "first\\\ntext";',
      'const result = `outer ${`inner\ntext`} end`;',
      'const result = `${"{"}\ntext`;',
      'const result = `first\\\ntext`;',
    ]) {
      const source = `<div>\n${template('script', body)}</div>\n`;
      const formatted = await stable(source, options);
      assert.equal(result(formatted), result(source));
    }
  });
}

test('keeps ignored multiline JavaScript verbatim across passes', async () => {
  const source = template('script', '// prettier-ignore\nconst result = {\n    a: 1\n};');
  const formatted = await stable(source);
  assert.ok(formatted.includes('const result = {\n    a: 1\n};'));
  assert.equal(result(formatted), result(source));
});

test('preserves CSS string continuations with Doc indentation', async () => {
  const source = template('style', 'a::after { content: "first\\\ntext"; }');
  const formatted = await stable(source);
  assert.ok(formatted.includes('    content: "first\\\ntext";'));
});

test('does not rewrite CSS escapes around dynamic values', async () => {
  const body = String.raw`a::after {content:'a\'{{x}}"';}`;
  const formatted = await stable(template('style', body));
  assert.equal(formatted, template('style', '  ' + body.replace('{{x}}', '{{ x }}')));
});

test('restores CSS property, selector, value, and calc tokens', async () => {
  const source = template('style', '.{{class}}{ {{property}}:{{color}};width:calc(({{expr}})*2); }');
  const formatted = await stable(source);
  const rendered = mustache.render(formatted, { class: 'card', property: 'background-color', color: 'red', expr: '1px + 2px' });
  assert.match(rendered, /\.card \{/);
  assert.match(rendered, /background-color: red;/);
  assert.match(rendered, /width: calc\(\(1px \+ 2px\) \* 2\);/);
});

test('avoids case-insensitive marker collisions and replacement cascades', async () => {
  const source = template('script', 'const result = ["M0_0-XZ", "m1_0-xz", "{{m2_}}", "{{x}}"];');
  const formatted = await stable(source);
  assert.equal(result(formatted, { m2_: 'one', x: 'two' }), result(source, { m2_: 'one', x: 'two' }));
});

test('uses restored widths with short delimiters and many tokens', async () => {
  const bodies = [
    'const result = collect("|x|", "|x|", "|x|", "|x|");',
    `const result = [${Array(80).fill('"|x|"').join(',')}];`,
  ];
  for (const body of bodies) {
    const source = '{{= | | =}}\n' + template('script', body);
    const normalized = template('script', body.replaceAll('|x|', '| x |'));
    for (const printWidth of [40, 60, 80]) {
      const options = { printWidth };
      const expected = '{{= | | =}}\n' + await prettier.format(normalized, { parser: 'html', ...options });
      assert.equal(await stable(source, options), expected);
    }
  }
});

for (const attrs of [
  ' type=module',
  ' data-type="application/json"',
  ' data-src="app.js"',
  ` data-note='src="app.js" type="application/json" >'`,
  ' defer type = "text/javascript"',
  ' type="" type="application/json"',
]) {
  test(`recognizes script attributes correctly: ${attrs.trim()}`, async () => {
    assert.equal(await stable(template('script', 'const x={a:1};', attrs)), template('script', '  const x = { a: 1 };', attrs));
  });
}

for (const attrs of [' src', ' src=app.js', ' type=application/json', ' type="application/json" type=module', ' lang=ts']) {
  test(`retains the fallback for script attributes: ${attrs.trim()}`, async () => {
    assert.equal(await stable(template('script', '[1,2]', attrs)), template('script', '  [1,2]', attrs));
  });
}

test('does not format non-CSS style languages as CSS', async () => {
  for (const attrs of [' lang=scss', ' type=text/less']) {
    assert.equal(await stable(template('style', 'a{color:red}', attrs)), template('style', '  a{color:red}', attrs));
  }
});

test('resumes embedding after an earlier unsupported inline closing shape', async () => {
  const source = '<div>\n<script>\nconst x=1;</script>\n<p>Hi</p>\n' + template('script', 'const y={a:1};') + '</div>\n';
  const formatted = await stable(source);
  assert.ok(formatted.includes('  <p>Hi</p>\n  <script>\n    const y = { a: 1 };\n  </script>\n</div>'));
});

test('propagates delimiter changes from a fallback body to following HTML', async () => {
  const source = template('script', '{{=<% %>=}}\nconst x="<%value%>";') + '<p><%value%></p>\n';
  const formatted = await stable(source);
  assert.ok(formatted.includes('const x="<% value %>";'));
  assert.ok(formatted.includes('<p><% value %></p>'));
});

test('honors the configured Babel parser, preprocessing, and plugin order with dynamic strings', async () => {
  let calls = 0;
  const earlierParser = {
    parsers: { babel: { ...babelParsers.babel, parse() { throw new Error('The last plugin must win'); } } },
  };
  const configuredParser = {
    parsers: {
      babel: {
        ...babelParsers.babel,
        preprocess(source) {
          return source.replace('SOURCE_TEXT', 'processed');
        },
        parse(source, options) {
          calls += 1;
          assert.ok(source.includes('processed'));
          assert.equal(options.parser, 'babel');
          return babelParsers.babel.parse(source, options);
        },
      },
    },
  };
  const source = template('script', 'const result=["SOURCE_TEXT", "{{key}}"];');
  const formatted = await stable(source, { plugins: [plugin, earlierParser, configuredParser], semi: false, singleQuote: true });
  assert.equal(calls, 2);
  assert.equal(formatted, template('script', "  const result = ['processed', '{{ key }}']"));
});

for (const [parserName, parser, tag, body] of [
  ['css', cssParsers.css, 'style', 'a{ {{property}}:red; }'],
  ['babel', babelParsers.babel, 'script', 'const result="{{property}}";'],
]) {
  for (const mode of ['drop', 'duplicate']) {
    test(`falls back when the delegated ${parserName} parser would ${mode} a token`, async () => {
      let delegated = false;
      const changingParser = {
        parsers: {
          [parserName]: {
            ...parser,
            parse(source, options) {
              delegated = true;
              const changed = source.replace(/m\d+_[a-z0-9]+-x*z/g, (marker) => mode === 'drop' ? 'lost' : `${marker}${marker}`);
              return parser.parse(changed, options);
            },
          },
        },
      };
      const source = template(tag, body);
      const formatted = await stable(source, { plugins: [plugin, changingParser] });
      assert.equal(delegated, true);
      assert.equal(formatted, template(tag, '  ' + body.replace('{{property}}', '{{ property }}')));
    });
  }
}

test('does not share placeholder state between concurrent format calls', async () => {
  await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const source = template('script', `const result={"{{key${index}}}":${index}};`);
    const formatted = await stable(source);
    const view = { [`key${index}`]: `item-${index}` };
    assert.equal(result(formatted, view), result(source, view));
  }));
});
