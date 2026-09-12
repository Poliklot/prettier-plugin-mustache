import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import mustache from 'mustache';
import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';
import { parse } from '../dist/parser.js';
import { restorePlaceholderDoc } from '../dist/placeholder-doc.js';

const b = prettier.doc.builders;
const format = (source, options = {}) => prettier.format(source, { parser: 'mustache', plugins: [plugin], ...options });
const renderDoc = (value, options = {}) => prettier.doc.printer.printDocToString(value, {
  printWidth: 80, tabWidth: 2, useTabs: false, ...options,
}).formatted;
async function stable(source, options = {}) {
  const once = await format(source, options);
  const twice = await format(once, options);
  assert.equal(twice, once);
  assert.equal(await format(twice, options), twice);
  return once;
}

// Recorded from the released 0.2.0 printer before refactoring, not regenerated
// during tests. Keep that historical fixture intact. The explicitly reviewed
// hardening delta replaces only fallback raw bodies with their original source;
// every other byte of the old expected output remains the compatibility oracle.
const characterizations = JSON.parse(fs.readFileSync(new URL('./fixtures/native-doc-characterization.json', import.meta.url)));
function reviewedRawSourceDelta(name, source, options, expected) {
  if (name === 'unclosed') return source; // Do not trim unknown/unclosed source either.
  // These fixed fixtures have no greater-than signs in attributes. This helper
  // is an independent test oracle, not the implementation's boundary scanner.
  const pattern = /(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/g;
  const originals = [...source.matchAll(pattern)];
  let index = 0;
  return expected.replace(pattern, (whole, opening, tag, _body, closing) => {
    const original = originals[index++];
    const preserve = options.embeddedLanguageFormatting === 'off' ||
      name === 'emptyRaw' || name === 'unsupported' ||
      (name === 'delimiters' && tag === 'script') || (name === 'closing' && index === 1);
    return preserve ? opening + original[3] + closing : whole;
  });
}
for (const { name, source, options, expected } of characterizations) {
  test(`0.2.0 characterization with reviewed raw-source delta: ${name} ${JSON.stringify(options)}`, async () => {
    assert.equal(await stable(source, options), reviewedRawSourceDelta(name, source, options, expected));
  });
}

test('discovers ranged child embed targets without visiting the syntax AST twice', () => {
  const source = '<div>\n<script>\nconst x="{{key}}";\n</script>\n<style>\na{color:{{color}};}\n</style>\n</div>\n';
  const ast = parse(source);
  assert.deepEqual(plugin.printers['mustache-ast'].getVisitorKeys(ast), ['segments']);
  const bodies = ast.segments.filter((node) => node.type === 'RawTextElement').map((node) => node.body);
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(source.slice(...body.range), body.text);
    assert.equal(body.depth, 2);
    assert.equal(typeof plugin.printers['mustache-ast'].embed({ node: body }, {}), 'function');
  }
  assert.equal(plugin.printers['mustache-ast'].embed({ node: ast }, {}), null);
});

test('the plugin never renders embedded Docs privately', async () => {
  const original = prettier.doc.printer.printDocToString;
  prettier.doc.printer.printDocToString = () => { throw new Error('Private renderer called'); };
  try {
    assert.equal(await format('<script>\nconst x={"{{key}}":1};\n</script>'),
      '<script>\n  const x = { "{{ key }}": 1 };\n</script>\n');
  } finally {
    prettier.doc.printer.printDocToString = original;
  }
});

for (const body of [
  String.raw`const result=html\`<script><\/script>\`;`.replaceAll('\\`', '`'),
  String.raw`const result=/* HTML */ \`<script>const x=1;<\/script>\`;`.replaceAll('\\`', '`'),
]) {
  test(`nested HTML embedding cannot introduce an outer script close: ${body}`, async () => {
    const source = `<script>\n${body}\n</script>\n`;
    for (const printWidth of [20, 80]) {
      const output = await stable(source, { printWidth });
      assert.equal(output, await prettier.format(source, { parser: 'html', printWidth }));
      assert.equal([...output.matchAll(/<\/script[\t\n\f\r />]/gi)].length, 1);
      assert.ok(output.includes('<\\/script>'));
    }
  });
}

for (const attrs of ['', ' type="module"', ' type="text/babel" data-type="module"']) {
  test(`embedded JS keeps the native HTML source type: ${attrs || 'classic script'}`, async () => {
    const source = `<script${attrs}>\nawait\n("{{value}}")\n</script>\n`;
    const output = await stable(source);
    const expected = await prettier.format(source.replace('{{value}}', '{{ value }}'), { parser: 'html' });
    assert.equal(output, expected);
    if (!attrs) {
      const body = mustache.render(output.slice(output.indexOf('>') + 1, output.lastIndexOf('</script>')), { value: 'hello' });
      const received = [];
      vm.runInNewContext(body, { await: (value) => received.push(value) }, { timeout: 1000 });
      assert.deepEqual(received, ['hello']);
    }
  });
}

const marker = 'm0_0-xz';
const replacements = () => new Map([[marker, '{{ value }}']]);
const token = `"${marker}"`;
for (const width of [8, 80]) {
  test(`validates alternative layouts, not the sum of their markers, at width ${width}`, () => {
    const first = ['[', token, ']'];
    const second = ['[', b.indent([b.hardline, token]), b.hardline, ']'];
    const value = b.conditionalGroup([first, second]);
    const restored = restorePlaceholderDoc(value, replacements());
    assert.notEqual(restored, null);
    const printed = renderDoc(restored, { printWidth: width });
    assert.equal(printed.split('{{ value }}').length, 2);
    assert.ok(!printed.includes(marker));
  });
}

test('restores ifBreak branches and keeps group references intact', () => {
  const id = Symbol('outer');
  const value = b.group([b.ifBreak(token, token, { groupId: id }), b.line,
    b.indentIfBreak('tail', { groupId: id })], { id });
  const restored = restorePlaceholderDoc(value, replacements());
  assert.notEqual(restored, null);
  assert.equal(restored.id, id);
  assert.equal(restored.contents[0].groupId, id);
  assert.equal(renderDoc(restored), '"{{ value }}" tail');
});

for (const [name, make] of [
  ['dropped alternate', () => b.conditionalGroup([token, 'lost'])],
  ['duplicated alternate', () => b.conditionalGroup([token, [token, token]])],
  ['conditional drop', () => b.ifBreak(token, 'lost')],
  ['duplicate shared node', () => { const shared = b.group(token); return [shared, shared]; }],
  ['split marker', () => ['m', '0_', '0-xz']],
  ['extra split marker', () => [token, 'm', '0_', '0-xz']],
  ['split through softline', () => [token, 'm', b.softline, '0_0-xz']],
  ['suffix-reordered split', () => [token, 'm', b.lineSuffix(' // end'), '0_0-xz']],
  ['text-producing alignment', () => [token, b.align('m', [b.hardline, '0_0-xz'])]],
  ['trim-dependent source', () => [token, 'm ', b.trim, '0_0-xz']],
]) {
  test(`falls back for ${name} without choosing a wrap width`, () => {
    assert.equal(restorePlaceholderDoc(make(), replacements()), null);
  });
}

test('keeps literal lines, fill, labels and line suffixes as native Docs', () => {
  const value = b.group([b.label('body', b.fill([token, b.line, 'tail'])),
    b.lineSuffix(' // comment'), b.hardline, b.lineSuffixBoundary,
    b.indent(['`first', b.literalline, 'verbatim`'])]);
  const restored = restorePlaceholderDoc(value, replacements());
  assert.notEqual(restored, null);
  assert.equal(renderDoc(restored), '"{{ value }}" tail // comment\n`first\nverbatim`');
});

test('does not mutate the delegated Doc or restoration map', () => {
  const value = b.fill([token, b.line, 'end']);
  const map = replacements();
  Object.freeze(value.parts);
  Object.freeze(value);
  assert.notEqual(restorePlaceholderDoc(value, map), null);
  assert.equal(value.parts[0], token);
  assert.equal(map.get(marker), '{{ value }}');
});

// Compare native HTML embedding after normalizing the safe Mustache spelling.
// This oracle checks that the surrounding depth participates in the *same*
// final layout, including the first body line and literal-line behavior.
for (const useTabs of [false, true]) {
  for (const tabWidth of [2, 4]) {
    for (const printWidth of [30, 100]) {
      for (const endOfLine of ['lf', 'crlf', 'cr', 'auto']) {
        test(`native layout matrix ${JSON.stringify({ useTabs, tabWidth, printWidth, endOfLine })}`, async () => {
          const options = { useTabs, tabWidth, printWidth, endOfLine, singleQuote: true,
            semi: false, arrowParens: 'avoid', quoteProps: 'consistent', trailingComma: 'all' };
          const source = '<main>\n<div>\n<script>\nconst result={"{{key}}": ["{{value}}",(x)=>({a:x,b:2})]}; // suffix\nconst literal=`first\n  second`;\n</script>\n<style>\na { color:red; width:calc(1px + 2px); }\n</style>\n</div>\n</main>\n';
          const input = endOfLine === 'auto' ? source.replaceAll('\n', '\r\n') : source;
          const normalized = input.replaceAll('{{key}}', '{{ key }}').replaceAll('{{value}}', '{{ value }}');
          const expected = await prettier.format(normalized, { parser: 'html', ...options });
          assert.equal(await stable(input, options), expected);
        });
      }
    }
  }
}

test('concurrent formats isolate delimiters, marker salts and Docs', async () => {
  const results = await Promise.all(Array.from({ length: 32 }, async (_, index) => {
    const source = index % 2 ? '{{= | | =}}\n<script>\nconst result={"|key|":"|value|"};\n</script>\n'
      : '<script>\nconst result={"{{key}}":"{{value}}"};\n</script>\n';
    const output = await stable(source, { printWidth: 20 + index, useTabs: index % 3 === 0 });
    const rendered = mustache.render(output, { key: 'foo-bar', value: `value${index}` });
    const body = rendered.slice(rendered.indexOf('<script>') + 8, rendered.indexOf('</script>'));
    assert.equal(vm.runInNewContext(`${body}\nJSON.stringify(result)`), JSON.stringify({ 'foo-bar': `value${index}` }));
    return output;
  }));
  assert.equal(results.length, 32);
});

test('characterizes cursor mapping and unsupported partial-range formatting', async () => {
  const source = '<div>\n<script>\nconst result={"{{key}}":1};\n</script>\n<p>{{label}}</p>\n</div>\n';
  const expected = await format(source);
  for (const [cursorOffset, expectedOffset] of [[0, 0], [21, 27], [32, 41], [58, 75], [77, 96]]) {
    const result = await prettier.formatWithCursor(source, { parser: 'mustache', plugins: [plugin], cursorOffset });
    assert.equal(result.formatted, expected);
    assert.equal(result.cursorOffset, expectedOffset);
  }
  // Same as 0.2.0: partial selections are a no-op, not syntax-aware range edits.
  for (const [rangeStart, rangeEnd] of [[0, 0], [21, 43], [53, 69]]) {
    assert.equal(await format(source, { rangeStart, rangeEnd }), source);
  }
  assert.equal(await format(source, { rangeStart: 0, rangeEnd: source.length }), expected);
});

test('preserves rendered JS and canonical CSS over values, delimiters and options', async () => {
  const views = [
    { key: 'foo-bar', value: 'quoted"text', color: 'rgb(10, 20, 30)', property: 'background-color', class: 'card', expr: '1px + 2px' },
    { key: 'Ω🙂', value: '<b>&/=x', color: 'var(--color)', property: '--custom', class: 'x:hover', expr: 'var(--width)' },
    { key: '', value: '\\u0022', color: '#aabbcc', property: 'color', class: 'UPPERCASE', expr: '4px' },
  ];
  const scripts = [
    'const result={"{{key}}": ["{{value}}","{{key}}{{value}}"]};',
    'const result=`outer ${"{{value}}"} ${`inner\n  text`}`;',
    'const result="first\\\n  second"; // suffix',
    '// prettier-ignore\nconst result = {\n    "{{key}}":"{{value}}"\n};',
    'const result=({{&expr}})*2;',
  ];
  const styles = [
    '.{{class}}{ {{property}}:{{color}};width:calc(({{expr}})*2); }',
    'a::after{content:"first\\\n  second";} /* comment */',
  ];
  for (const options of [{}, { singleQuote: true, semi: false, printWidth: 25 },
    { quoteProps: 'preserve', trailingComma: 'none', tabWidth: 4, useTabs: true }]) {
    for (const custom of [false, true]) {
      for (const [tag, bodies] of [['script', scripts], ['style', styles]]) {
        for (const body of bodies) {
          const inputBody = custom ? body.replaceAll('{{', '<%').replaceAll('}}', '%>') : body;
          const source = `${custom ? '{{= <% %> =}}\n' : ''}<div>\n<${tag}>\n${inputBody}\n</${tag}>\n<p>after</p>\n</div>\n`;
          const formatted = await stable(source, options);
          for (const sample of views) {
            const view = tag === 'script' ? { ...sample, expr: '1 + 2' } : sample;
            const extract = (text) => {
              const rendered = mustache.render(text, view);
              return rendered.slice(rendered.indexOf(`<${tag}>`) + tag.length + 2, rendered.indexOf(`</${tag}>`));
            };
            if (tag === 'script') {
              const evaluate = (text) => vm.runInNewContext(`${extract(text)}\nJSON.stringify(result)`, {}, { timeout: 1000 });
              assert.equal(evaluate(formatted), evaluate(source));
            } else {
              assert.equal(await prettier.format(extract(formatted), { parser: 'css' }),
                await prettier.format(extract(source), { parser: 'css' }));
            }
          }
        }
      }
    }
  }
});

test('child embedding accepts valid custom-printer alternatives and rejects unsafe ones', async () => {
  const { parsers } = await import('prettier/plugins/babel');
  const source = '<div>\n<script>\nconst result="{{key}}";\n</script>\n</div>\n';
  for (const unsafe of [false, true]) {
    const configured = {
      parsers: { babel: { ...parsers.babel, astFormat: 'custom-doc', parse: (text) => ({ text }) } },
      printers: { 'custom-doc': {
        getVisitorKeys: () => [],
        print(path) {
          const marker = path.node.text.match(/m\d+_[a-z0-9]+-x*z/)[0];
          return b.conditionalGroup([
            `const result = "${marker}";`,
            ['const result =', b.indent([b.line, `"${unsafe ? 'lost' : marker}";`])],
          ]);
        },
      } },
    };
    for (const printWidth of [20, 100]) {
      const output = await stable(source, { plugins: [plugin, configured], printWidth });
      if (unsafe) assert.ok(output.includes('const result="{{key}}";'));
      else assert.ok(output.includes('const result ='));
      assert.equal(output.split(unsafe ? '{{key}}' : '{{ key }}').length, 2);
      assert.ok(!output.includes('m0_'));
    }
  }
});

test('handles thousands of distinct substitutions and hundreds of independent embed nodes', async () => {
  const count = 2000;
  const body = `const result=[${Array.from({ length: count }, (_, i) => `"{{value${i}}}"`).join(',')}];`;
  const source = `<script>\n${body}\n</script>\n`;
  const output = await stable(source, { printWidth: 60 });
  assert.equal((output.match(/{{ value\d+ }}/g) ?? []).length, count);
  const view = Object.fromEntries(Array.from({ length: count }, (_, i) => [`value${i}`, `result-${i}`]));
  const rendered = mustache.render(output, view);
  const script = rendered.slice(rendered.indexOf('<script>') + 8, rendered.indexOf('</script>'));
  assert.equal(vm.runInNewContext(`${script}\nJSON.stringify(result)`),
    JSON.stringify(Array.from({ length: count }, (_, i) => `result-${i}`)));
  const blocks = Array.from({ length: 300 }, (_, i) => `<script>\nconst x${i}={"{{key}}":${i}};\n</script>`).join('\n');
  const formattedBlocks = await stable(blocks);
  assert.equal(formattedBlocks.split('{{ key }}').length - 1, 300);
  assert.equal(formattedBlocks.split('</script>').length - 1, 300);
});
