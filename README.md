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

| Mustache feature | Example | Status |
| --- | --- | --- |
| Plain text templates | `Hello from {Mustache}!` | Preserved |
| Escaped variables | `{{name}}` | Formatted |
| Dotted names | `{{user.name}}` | Formatted |
| Implicit iterator | `{{.}}` | Formatted |
| Triple mustache | `{{{html}}}` | Formatted |
| Ampersand unescaped variables | `{{& html}}` | Formatted |
| Comments | `{{! comment}}` | Formatted |
| Multiline comments | `{{! first\nsecond }}` | Preserved/formatted |
| Sections | `{{#items}}...{{/items}}` | Formatted |
| Inverted sections | `{{^items}}...{{/items}}` | Formatted |
| Lambda sections | `{{#wrapped}}...{{/wrapped}}` | Syntax formatted; runtime behavior belongs to the renderer |
| Partials | `{{> user}}` | Formatted |
| Dynamic partial names | `{{>*partial}}` | Formatted |
| Set delimiters | `{{=<% %>=}}` | Formatted and tracked |
| Delimiter reset | `<%={{ }}=%>` | Formatted and tracked |
| Blocks/inheritance extension | `{{$title}}...{{/title}}` | Formatted |
| Parent templates | `{{< layout}}...{{/layout}}` | Formatted |
| Dynamic parent names | `{{<*layout}}...{{/*layout}}` | Formatted |
| Standalone comments / partials / delimiter tags | `{{! comment}}`, `{{> user}}`, `{{=<% %>=}}` | Formatted in multiline sections |
| Broken/unmatched tags | `{{#items}}...` | Preserved raw instead of throwing |

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
- The plugin normalizes Mustache syntax and section indentation; it does not parse embedded HTML/CSS/JS as separate languages yet.
- Lambda behavior, partial loading, recursive partial expansion, HTML escaping, and context lookup are runtime renderer responsibilities.
- This package does not claim Handlebars compatibility. Use [`@poliklot/prettier-plugin-handlebars`](https://www.npmjs.com/package/@poliklot/prettier-plugin-handlebars) for classic Handlebars templates.
- This package does not claim Ember/Glimmer compatibility.

## Development

```bash
npm install
npm run check
npm run pack:check
```

CI runs the same checks on Node 18, 20, and 22.
