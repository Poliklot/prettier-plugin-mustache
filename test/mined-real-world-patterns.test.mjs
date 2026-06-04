import assert from 'node:assert/strict';
import { test } from 'node:test';
import prettier from 'prettier';

const plugin = await import('../dist/plugin.js');

const patterns = [
  {
    name: 'OpenAPI operation list with vendor extension guards',
    source: '{{#operations}}\n{{#operation}}\n{{#vendorExtensions.x-tags}}\n- {{.}}\n{{/vendorExtensions.x-tags}}\n{{/operation}}\n{{/operations}}',
  },
  {
    name: 'OpenAPI model enum values with comments and partials',
    source: '{{#allowableValues}}\n{{#enumVars}}\n{{! enum var}}\n{{> enumValue}}\n{{/enumVars}}\n{{/allowableValues}}',
  },
  {
    name: 'Swagger codegen params table',
    source: '{{#allParams}}\n{{#required}}*{{/required}}{{paramName}}: {{dataType}}\n{{/allParams}}',
  },
  {
    name: 'Mustache.js higher-order section shape',
    source: '{{#wrapped}}\n{{name}} is awesome.\n{{/wrapped}}',
  },
  {
    name: 'Markdown partial heavy template',
    source: '# {{title}}\n\n{{#sections}}\n## {{name}}\n{{> body}}\n{{/sections}}',
  },
  {
    name: 'HTML email rows with inverted fallback',
    source: '<table>{{#rows}}<tr><td>{{label}}</td><td>{{value}}</td></tr>{{/rows}}{{^rows}}<tr><td colspan="2">Empty</td></tr>{{/rows}}</table>',
  },
  {
    name: 'Dynamic partial slot pattern',
    source: '{{#slots}}\n{{>*partial}}\n{{/slots}}',
  },
  {
    name: 'Parent layout with body and title blocks',
    source: '{{< layout}}\n{{$title}}{{title}}{{/title}}\n{{$body}}{{#items}}<li>{{name}}</li>{{/items}}{{/body}}\n{{/layout}}',
  },
  {
    name: 'Delimiter switch around generated snippets',
    source: '{{=<% %>=}}\n<%#items%>\n<%name%>\n<%/items%>\n<%={{ }}=%>\n{{again}}',
  },
  {
    name: 'Question mark predicate keys from classic Mustache examples',
    source: '{{#person?}}\nHi {{name}}!\n{{/person?}}\n{{^person?}}Nobody\n{{/person?}}',
  },
  {
    name: 'Nested dotted names in text-heavy API docs',
    source: '{{#apiInfo}}\n{{#apis}}\n{{classname}} - {{baseName}} - {{version}}\n{{/apis}}\n{{/apiInfo}}',
  },
  {
    name: 'Standalone delimiter plus partial after indentation',
    source: '{{#section}}\n  {{=<% %>=}}\n  <%> row%>\n<%/section%>',
  },
];

async function format(source, options = {}) {
  return prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
    ...options,
  });
}

for (const pattern of patterns) {
  test(`real-world pattern: ${pattern.name}`, async () => {
    const once = await format(pattern.source);
    const twice = await format(once);
    assert.equal(twice, once);
  });
}

test('real-world patterns respect project indentation options', async () => {
  const source = '{{#operations}}\n{{#operation}}\n{{summary}}\n{{/operation}}\n{{/operations}}';

  assert.equal(
    await format(source, { tabWidth: 4 }),
    '{{#operations}}\n    {{#operation}}\n        {{ summary }}\n    {{/operation}}\n{{/operations}}\n',
  );

  assert.equal(
    await format(source, { useTabs: true }),
    '{{#operations}}\n\t{{#operation}}\n\t\t{{ summary }}\n\t{{/operation}}\n{{/operations}}\n',
  );
});
