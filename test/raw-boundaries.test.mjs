import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';
import { parse } from '../dist/parser.js';
import { discoverProtectedRegions } from '../dist/raw-regions.js';

const format = (source, options = {}) => prettier.format(source, { parser: 'mustache', plugins: [plugin], ...options });
async function stable(source, options = {}) {
  const once = await format(source, options);
  const twice = await format(once, options);
  assert.equal(twice, once);
  assert.equal(await format(twice, options), once);
  return once;
}

for (const opening of [
  '<script\n type="module"\n>',
  '<script data-note="first >\n  second <script>"\n defer>',
  '<script\n data-type="application/json"\n data-note=\'type="application/json" >\'\n>',
  '<SCRIPT\n TYPE = module\n>',
]) {
  test(`embeds a ranged body after a multiline opening tag: ${JSON.stringify(opening)}`, async () => {
    const source = `<div>\n${opening}\nconst result={"{{key}}":1};\n</script>\n<p>{{label}}</p>\n</div>\n`;
    const ast = parse(source);
    const element = ast.segments.find((node) => node.type === 'RawTextElement');
    assert.ok(element);
    assert.equal(source.slice(...element.body.range), element.body.text);
    assert.equal(source.slice(...element.range), `${opening}\nconst result={"{{key}}":1};\n</script>`);
    assert.deepEqual(plugin.printers['mustache-ast'].getVisitorKeys(element), ['body']);
    const output = await stable(source);
    assert.ok(output.includes('    const result = { "{{ key }}": 1 };\n  </script>'));
    assert.ok(output.includes(opening));
    assert.ok(output.includes('  <p>{{ label }}</p>\n</div>'));
  });
}

for (const opaque of [
  '<script>const x="{{value}}";</script>',
  '<script>\nconst x="{{value}}";</script>',
  '<script>\n  const x="{{value}}";\n</script data-end=yes>',
  '<script/>\n  const x="{{value}}";\n</script>',
  '<script>\n  const x="{{value}}";\n</script/><p>same line</p>',
  '<!--\n<script>\nconst x={a:1};\n</script>\n-->',
  '<textarea>\n<script>\nconst x={a:1};\n</script>\n</textarea>',
  '<pre>\n  first  \n<script>\nconst x={a:1};\n</script>\n</pre>',
  '<svg>\n<foreignObject>\n<script>\nconst x={a:1};\n</script>\n</foreignObject>\n</svg>',
  '<svg>\n<svg></svg>\n<script>\nconst x={a:1};\n</script>\n</svg>',
  '<pre>\n<span title="</pre>">raw</span>\n<script>\nconst x={a:1};\n</script>\n</pre>',
  '<svg><![CDATA[</svg>]]>\n<script>\nconst x={a:1};\n</script>\n</svg>',
  '<script>\n<!--\n<script>\n</script>\n-->\nconst x=1;\n</script>',
]) {
  test(`preserves a complete opaque region and resumes after it: ${JSON.stringify(opaque)}`, async () => {
    const source = `<div>\n${opaque}\n<p>{{label}}</p>\n<script>\nconst y={a:1};\n</script>\n</div>\n`;
    const output = await stable(source);
    assert.ok(output.includes(opaque));
    assert.ok(output.includes('  <p>{{ label }}</p>\n  <script>\n    const y = { a: 1 };\n  </script>\n</div>'));
  });
}

for (const tail of [
  '<script>\nconst result=`first  \n    second`;',
  '<script\n type=module>  \n\n const x="{{value}}";  \n\n',
  '<style>\n  a {content:"{{value}}"}  ',
  '<textarea>\n  text  \n\n',
  '<!--\n  comment  \n\n',
  '<script>\n{{#enabled}}\nconst result=`first  \n  second`;  \n\n',
  '<script>\nconst result="{{value";  \n\n',
]) {
  test(`unterminated raw source retains EOF whitespace: ${JSON.stringify(tail)}`, async () => {
    assert.equal(await stable(tail), tail);
  });
}

test('does not discover scripts inside quoted attributes or Mustache tokens', async () => {
  const source = '<div data-note="<script>\nconst x={a:1};\n</script>">\n{{! <script> const y=1; </script> }}\n</div>\n';
  assert.equal(parse(source).segments.filter((node) => node.type === 'RawTextElement').length, 0);
});

test('self-closing foreign containers do not consume following HTML', async () => {
  const output = await stable('<svg/>\n<math />\n<script>\nconst x={a:1};\n</script>\n');
  assert.equal(output, '<svg/>\n<math />\n<script>\n  const x = { a: 1 };\n</script>\n');
});

test('HTML prettier-ignore preserves the following raw element', async () => {
  const ignored = '<script> \nconst result="{{value}}";  \n</script>';
  const source = `<!-- prettier-ignore -->\n${ignored}\n<script>\nconst x={a:1};\n</script>\n`;
  assert.equal(await stable(source), `<!-- prettier-ignore -->\n${ignored}\n<script>\n  const x = { a: 1 };\n</script>\n`);
});

test('indents only outside protected regions, not their internal text', async () => {
  const source = '<div>\n       <!-- note  {{value}} -->\n<title>  {{value}}  </title>\n<pre>\n   literal  \n</pre>\n</div>\n';
  const expected = '<div>\n  <!-- note  {{value}} -->\n  <title>  {{value}}  </title>\n  <pre>\n   literal  \n</pre>\n</div>\n';
  assert.equal(await stable(source), expected);
});

test('HTML raw close names require an ASCII boundary, even inside JS strings', () => {
  const source = '<script>\nconst a="</scriptx>";\nconst b="</script\u00a0>";\nconst c="</script>";\n<p>after</p>';
  const [region] = discoverProtectedRegions(source, []);
  assert.equal(region.closeStart, source.indexOf('</script>'));
});

for (const escape of ['<!-->', '<!--->', '<!---->', '<!--\n-->']) {
  test(`script escape exits can overlap their opener: ${JSON.stringify(escape)}`, async () => {
    const opaque = `<script>${escape}<script></script>`;
    const source = `${opaque}\n<p>{{label}}</p>\n`;
    assert.equal(discoverProtectedRegions(source, [])[0].closeStart, source.indexOf('</script>'));
    assert.equal(await stable(source), `${opaque}\n<p>{{ label }}</p>\n`);
  });
}

test('a raw close does not terminate early at a quoted greater-than sign in end-tag attributes', async () => {
  const opaque = '<script>\nconst x="{{value}}";\n</script data-note=">">';
  const output = await stable(`${opaque}\n<p>{{label}}</p>\n`);
  assert.equal(output, `${opaque}\n<p>{{ label }}</p>\n`);
});

for (const attrs of [' data=x="', " data=x='", ' data=="', ' data="x"="']) {
  test(`invalid quotes in unquoted attributes do not hide a tag boundary: ${attrs}`, async () => {
    const source = `<script${attrs}>\nconst x="{{value}}";\n</script>\n<p>{{label}}</p>\n`;
    const [region] = discoverProtectedRegions(source, []);
    assert.equal(region.openEnd, source.indexOf('>') + 1);
    assert.equal(await stable(source), source.replace('{{label}}', '{{ label }}'));
  });
}

test('all fallback cursor offsets inside raw text map to the same source character', async () => {
  const source = '<div>\n<script> \n  const result=`first  \n    {{value}}`;\n\t </script>\n</div>\n';
  const ast = parse(source);
  const body = ast.segments.find((node) => node.type === 'RawTextElement').body;
  const formatted = await format(source);
  const outputStart = formatted.indexOf('> ', formatted.indexOf('<script')) + 1;
  for (let offset = 0; offset < body.text.length; offset += 1) {
    const result = await prettier.formatWithCursor(source, { parser: 'mustache', plugins: [plugin], cursorOffset: body.range[0] + offset });
    assert.equal(result.formatted, formatted);
    assert.equal(result.cursorOffset, outputStart + offset);
  }
});

for (const whitespace of ['\u00a0', '\u000b', '\u2003', '\ufeff']) {
  test(`Unicode whitespace does not turn an opaque type into JavaScript: ${JSON.stringify(whitespace)}`, async () => {
    for (const attrs of [` type="${whitespace}module"`, ` type=module${whitespace}`, ` type="module${whitespace}"`]) {
      const source = `<script${attrs}>\n[1,2]\n</script>\n`;
      assert.equal(await stable(source), source);
    }
  });
}

test('Unicode whitespace inside an ordinary attribute does not hide the real type', async () => {
  const source = '<script data-note=\u00a0 type=module>\nconst x={a:1};\n</script>\n';
  assert.equal(await stable(source), '<script data-note=\u00a0 type=module>\n  const x = { a: 1 };\n</script>\n');
});

for (const attrs of [' type=" "', ' type="\t\n"', ' language=vbscript', ' language=" javascript "']) {
  test(`opaque legacy or whitespace-only script types remain source: ${JSON.stringify(attrs)}`, async () => {
    const source = `<script${attrs}>\n[1,2]\n</script>\n`;
    assert.equal(await stable(source), source);
  });
}

for (const attrs of [' language=JavaScript', ' language=vbscript type=module', ' language=vbscript type=""', ' type=" \tmodule\n "']) {
  test(`recognizes explicit type precedence and supported legacy language: ${JSON.stringify(attrs)}`, async () => {
    const source = `<script${attrs}>\nconst x={a:1};\n</script>\n`;
    assert.equal(await stable(source), `<script${attrs}>\n  const x = { a: 1 };\n</script>\n`);
  });
}
