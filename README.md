# prettier-plugin-mustache

[![npm version](https://img.shields.io/npm/v/prettier-plugin-mustache.svg)](https://www.npmjs.com/package/prettier-plugin-mustache)
[![CI](https://github.com/Poliklot/prettier-plugin-mustache/actions/workflows/ci.yml/badge.svg)](https://github.com/Poliklot/prettier-plugin-mustache/actions/workflows/ci.yml)

Prettier plugin for Mustache templates.

It formats `.mustache`, `.mst`, and `.mu` files with a focus on stable, idempotent output and Mustache syntax rather than Handlebars, Ember, or Glimmer extensions.

## Install

```bash
npm install --save-dev prettier prettier-plugin-mustache
```

## Quick Start

Recommended config:

```js
/** @type {import("prettier").Config} */
module.exports = {
  plugins: ["prettier-plugin-mustache"],
  overrides: [
    {
      files: ["*.mustache", "*.mst", "*.mu"],
      options: {
        parser: "mustache",
      },
    },
  ],
};
```

Then format templates:

```bash
npx prettier --write "**/*.{mustache,mst,mu}"
```

## Configuration Patterns

### Minimal setup

```json
{
  "plugins": ["prettier-plugin-mustache"]
}
```

### Explicit override

Use this when a repository contains several template languages and you want editor format-on-save to stay predictable.

```json
{
  "plugins": ["prettier-plugin-mustache"],
  "overrides": [
    {
      "files": ["*.mustache", "*.mst", "*.mu"],
      "options": {
        "parser": "mustache"
      }
    }
  ]
}
```

### Local plugin build during dogfooding

```js
/** @type {import("prettier").Config} */
module.exports = {
  plugins: ["../prettier-plugin-mustache/dist/plugin.js"],
  overrides: [
    {
      files: ["*.mustache", "*.mst", "*.mu"],
      options: {
        parser: "mustache",
      },
    },
  ],
};
```

## CLI

Published package:

```bash
npx prettier --write "src/**/*.{mustache,mst,mu}" --plugin prettier-plugin-mustache --parser mustache
```

Local plugin build:

```bash
npx prettier --write "src/**/*.{mustache,mst,mu}" --plugin ../prettier-plugin-mustache/dist/plugin.js --parser mustache
```

## API

```js
const prettier = require("prettier");
const plugin = require("prettier-plugin-mustache");

async function run(source) {
  return prettier.format(source, {
    filepath: "template.mustache",
    parser: "mustache",
    plugins: [plugin],
  });
}
```

## Supported File Extensions

- `.mustache`
- `.mst`
- `.mu`

## What The Plugin Handles Today

| Mustache feature                                | Example                                                 | Status                                                     |
| ----------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Plain text templates                            | `Hello from {Mustache}!`                                | Preserved                                                  |
| Escaped variables                               | `{{name}}`                                              | Formatted                                                  |
| Dotted names                                    | `{{user.name}}`                                         | Formatted                                                  |
| Implicit iterator                               | `{{.}}`                                                 | Formatted                                                  |
| Triple mustache                                 | `{{{html}}}`                                            | Formatted                                                  |
| Ampersand unescaped variables                   | `{{& html}}`                                            | Formatted                                                  |
| Comments                                        | `{{! comment}}`                                         | Formatted                                                  |
| Multiline comments                              | `{{! first\nsecond }}`                                  | Preserved/formatted                                        |
| Sections                                        | `{{#items}}...{{/items}}`                               | Formatted                                                  |
| Inverted sections                               | `{{^items}}...{{/items}}`                               | Formatted                                                  |
| Lambda sections                                 | `{{#wrapped}}...{{/wrapped}}`                           | Syntax formatted; runtime behavior belongs to the renderer |
| Partials                                        | `{{> user}}`                                            | Formatted                                                  |
| Dynamic partial names                           | `{{>*partial}}`                                         | Formatted                                                  |
| Set delimiters                                  | `{{=<% %>=}}`                                           | Formatted and tracked                                      |
| Delimiter reset                                 | `<%={{ }}=%>`                                           | Formatted and tracked                                      |
| Blocks/inheritance extension                    | `{{$title}}...{{/title}}`                               | Formatted                                                  |
| Parent templates                                | `{{< layout}}...{{/layout}}`                            | Formatted                                                  |
| Dynamic parent names                            | `{{<*layout}}...{{/*layout}}`                           | Formatted                                                  |
| Standalone comments / partials / delimiter tags | `{{! comment}}`, `{{> user}}`, `{{=<% %>=}}`            | Formatted in multiline sections                            |
| HTML with Mustache                              | `<a href="{{url}}">{{name}}</a>`                        | Indented/formatted                                         |
| Multiline HTML tags and attributes              | `<button\n  class="{{#primary}}...">`                   | Indented/formatted                                         |
| Conditional class blocks                        | `{{#primary}}btn-primary{{/primary}}` inside `class=""` | Indented/formatted                                         |
| Void/self-closing HTML tags                     | `<img src="{{src}}" />`, `<br />`                       | Preserved/formatted                                        |
| Broken/unmatched tags                           | `{{#items}}...`                                         | Preserved raw instead of throwing                          |

## Formatting Behavior

### Variables

```mustache
Hello {{name.first}} {{.}}, {{{html}}}, {{& raw}}
```

formats as:

```mustache
Hello {{ name.first }} {{ . }}, {{{ html }}}, {{& raw }}
```

### Inline sections stay inline

Mustache is whitespace-sensitive, so inline sections are kept inline instead of being expanded into extra newlines:

```mustache
{{#items}}<li>{{name}}</li>{{/items}}
```

formats as:

```mustache
{{#items}}<li>{{ name }}</li>{{/items}}
```

### Multiline sections are normalized

```mustache
{{#items}}
<li>{{name}}</li>
{{/items}}
```

formats as:

```mustache
{{#items}}
  <li>{{ name }}</li>
{{/items}}
```

### Prettier indentation options

Multiline sections respect normal Prettier indentation options such as `tabWidth` and `useTabs`.

With `tabWidth: 4`:

```mustache
{{#items}}
    <li>{{ name }}</li>
{{/items}}
```

With `useTabs: true`:

```mustache
{{#items}}
	<li>{{ name }}</li>
{{/items}}
```

### Inheritance extension

```mustache
{{< layout}}
{{$title}}Hello{{/title}}
{{/layout}}
```

formats as:

```mustache
{{< layout}}
  {{$title}}Hello{{/title}}
{{/layout}}
```

### HTML + Mustache templates

The plugin is HTML-aware: it keeps HTML and Mustache nesting aligned instead of treating the file as plain text or as Handlebars/Glimmer.

```mustache
<ul>
{{#items}}
<li>
<a href="{{url}}">{{name}}</a>
{{#children}}
<span>{{label}}</span>
{{/children}}
</li>
{{/items}}
</ul>
```

formats as:

```mustache
<ul>
  {{#items}}
    <li>
      <a href="{{ url }}">{{ name }}</a>
      {{#children}}
        <span>{{ label }}</span>
      {{/children}}
    </li>
  {{/items}}
</ul>
```

Multiline HTML tags, multiline attributes, conditional class blocks, partials, comments, tables, void tags, and self-closing tags are handled with stable indentation.

### Custom delimiters

```mustache
{{=<% %>=}}Hello <%name%> <%={{ }}=%> {{again}}
```

formats as:

```mustache
{{= <% %> =}}Hello <% name %> <%= {{ }} =%> {{ again }}
```

## Scope And Non-Goals

- This is a Mustache formatter, not a Mustache renderer.
- The plugin normalizes Mustache syntax and HTML+Mustache indentation, including nested HTML, multiline tags and attributes, conditional class blocks, partials, comments, tables, void tags, and self-closing tags.
- The plugin does not run separate Prettier sub-formatters for embedded CSS or JavaScript inside `<style>` / `<script>` blocks yet.
- Lambda behavior, partial loading, recursive partial expansion, HTML escaping, and context lookup are runtime renderer responsibilities.
- This package does not claim Handlebars compatibility. Use [`@poliklot/prettier-plugin-handlebars`](https://www.npmjs.com/package/@poliklot/prettier-plugin-handlebars) for classic Handlebars templates.
- This package does not claim Ember/Glimmer compatibility.

## Development

```bash
npm install
npm run check
npm run pack:check
npm run smoke:install
npm run corpus:check -- /path/to/templates
npm run corpus:oss
```

`npm run check` builds the plugin, runs unit/semantic/real-world-pattern tests, and runs deterministic fuzz coverage.

`npm run corpus:oss` clones and checks large public Mustache template corpora from Mustache.js, OpenAPI Generator, and Swagger Codegen. See [OSS corpus notes](docs/OSS_CORPUS.md).

CI runs build, tests, fuzz, pack validation, and install smoke checks on Node 18, 20, and 22.
