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

for (const tag of ['script', 'style', 'textarea', 'title', 'pre', 'svg', 'math']) {
  test(`EOF inside a quoted ${tag} end-tag attribute is not a completed close`, async () => {
    for (const quote of ['"', "'"]) {
      const source = `<${tag}>\n  literal  \n</${tag} data=${quote}>`;
      const [region] = discoverProtectedRegions(source, []);
      assert.equal(region.closeStart, undefined);
      assert.equal(region.terminal, true);
      assert.equal(await stable(source), source);
    }
  });
}

for (const tag of ['svg', 'math']) {
  for (const attrs of [' data=value/', ' data=value/ ', ' / ']) {
    test(`a slash is not automatically a ${tag} self-closing flag: ${attrs}`, async () => {
      const opaque = `<${tag}${attrs}>\n<script>\nconst x=1;\n</script>\n</${tag}>`;
      const source = `${opaque}\n<script>\nconst y=2;\n</script>\n`;
      const regions = discoverProtectedRegions(source, []);
      assert.equal(regions.length, 2);
      assert.equal(regions[0].end, opaque.length);
      assert.equal(await stable(source), `${opaque}\n<script>\n  const y = 2;\n</script>\n`);
    });
  }

  test(`nested ${tag} containers distinguish value slashes from self-closing flags`, async () => {
    const opaque = `<${tag}>\n<${tag} data=value/>\n</${tag}>\n<script>\nconst x=1;\n</script>\n</${tag}>`;
    assert.equal(discoverProtectedRegions(opaque, [])[0].end, opaque.length);
    assert.equal(await stable(`${opaque}\n`), `${opaque}\n`);
  });

  test(`actual ${tag} self-closing flags still allow subsequent embedding`, async () => {
    for (const attrs of [' data=value /', ' data="value"/', ' data/']) {
      const source = `<${tag}${attrs}>\n<script>\nconst x=1;\n</script>\n`;
      assert.equal(await stable(source), source.replace('const x=1;', '  const x = 1;'));
    }
  });
}

for (const declaration of ['<!DOCTYPE html PUBLIC "', '<!unknown ', '<![CDATA[']) {
  test(`does not embed a fake script opening inside a markup declaration: ${declaration}`, async () => {
    const source = `${declaration}\n<script>\nconst x=1;\n</script>\n<script>\nconst y=2;\n</script>\n`;
    const regions = discoverProtectedRegions(source, []);
    assert.equal(regions.filter((region) => region.embeddable).length, 1);
    const output = await stable(source);
    // Ordinary outer indentation remains allowed, but the apparent JS is text
    // and must not be parsed/reformatted as a script body.
    assert.match(output, /\n *const x=1;\n/);
    assert.ok(output.includes('  const y = 2;'));
  });
}

test('processing instructions exclude fake raw tags through their terminator or EOF', async () => {
  const instruction = '<?target\n<script>\nconst x=1;\n</script>\n?>';
  const source = `${instruction}\n<script>\nconst y=2;\n</script>\n`;
  const output = await stable(source);
  assert.equal(discoverProtectedRegions(source, []).length, 1);
  assert.ok(output.includes('const x=1;'));
  assert.ok(output.includes('  const y = 2;'));
  const unfinished = instruction.slice(0, -2) + '  ';
  assert.equal(discoverProtectedRegions(unfinished, []).length, 0);
  assert.ok((await stable(unfinished)).includes('const x=1;'));
});

test('instruction discovery does not disable ordinary non-HTML Mustache formatting', async () => {
  assert.equal(await stable('<?php\n$value="{{name}}";\n'), '<?php\n$value="{{ name }}";\n');
  for (const generic of ['List<?>', 'List<? extends T>']) {
    const source = `${generic}\n<script>\nconst x=1;\n</script>\n`;
    assert.equal(discoverProtectedRegions(source, []).length, 1);
    assert.ok((await stable(source)).includes('const x = 1;'));
  }
});
