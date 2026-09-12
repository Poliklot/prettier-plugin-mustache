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
| Embedded `<script>`/`<style>`                   | Opening and closing tags on separate, dedicated lines   | Safe bodies formatted with Prettier's `babel`/`css` printers |

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

### Embedded `<script>` and `<style>`

A `<script>` or `<style>` tag that sits alone on its own line, with its
closing tag alone on a later line, has its body reformatted with Prettier's
own `babel`/`css` printers instead of reindenting every line at the same depth.
Plain escaped Mustache values inside quoted JavaScript strings, or CSS
selectors/properties/values, are protected with collision-free placeholders.
They are restored in the Doc before final line wrapping, so the output width
is based on the real Mustache tags:

```mustache
<style>
[id="county-{{County}}"] {
fill: #d00;
}
</style>
<script>
setupZoombox({
mapId: "map",
targetId: "county-{{County}}",
});
</script>
```

formats as:

```mustache
<style>
  [id="county-{{ County }}"] {
    fill: #d00;
  }
</style>
<script>
  setupZoombox({
    mapId: "map",
    targetId: "county-{{ County }}",
  });
</script>
```

Opening tags may span multiple lines; their attribute spelling and internal
whitespace are retained. Source discovery creates ranged raw-element nodes
with separate body children, alongside outer line and opaque-source segments.
Each supported raw body uses Prettier's asynchronous `embed()` / `textToDoc()`
lifecycle. The outer printer composes their Docs, indentation and actual tag
boundaries into one document; Prettier performs the final rendering. There is
no intermediate embedded Doc-to-string rendering or newline slicing.
Template-literal contents, escaped line continuations, and verbatim comments
are therefore not given an extra indentation prefix on every pass.
The caller's applicable formatting options are inherited, including
`singleQuote`, `semi`, `arrowParens`, `tabWidth`, `useTabs`, and `printWidth`.
Set `embeddedLanguageFormatting: 'off'` to retain the original raw-body source.

**Intentional change from 0.2.0:** unsupported, disabled, empty or failed
embeddings preserve the entire body between the opening and closing tags.
This includes leading/trailing blank lines, indentation, trailing spaces,
Mustache spelling and the whitespace before the closing tag. Configured line
endings still apply. The old flat indentation could change multiline JS/CSS
literal values and raw input observed by Mustache lambdas; it has been removed.
The closing tag can consequently retain its original indentation on fallback.

Inline/malformed raw-tag shapes are preserved as opaque source regions rather
than being interpreted as outer HTML. Unterminated raw regions and incomplete
Mustache input retain their original EOF whitespace too. Comments, preformatted
and RCDATA/raw-text containers (such as `pre` and `textarea`), and SVG/MathML
fragments are protected from nested JS/CSS discovery. An HTML
`<!-- prettier-ignore -->` immediately before a raw element preserves it.
Whitespace before a protected opening may still receive ordinary outer
indentation; whitespace inside the protected region is not reindented.

Ordinary outer lines retain the existing formatting policy. Boundary discovery
is not a complete HTML tree builder: it does not implement browser tree repair,
full attribute reflow or arbitrary Mustache-generated markup.

Placeholder validation checks every alternative Doc layout before final wrapping,
not just the branch selected at one width. A custom printer that drops, duplicates
or splits markers, changes their inventory between alternatives, or uses unsupported
text-changing Doc commands is conservatively sent to the same fallback. This is
an intentional safety difference from accepting a Doc based on one rendered layout.

### Editor behavior

Whole-document formatting is the supported operation. Partial `rangeStart` /
`rangeEnd` selections currently leave the source unchanged in the tested Prettier 3
versions; this refactor does not introduce syntax-aware range formatting.
`formatWithCursor()` uses Prettier's generic cursor mapping. Tests characterize
positions in JS, Mustache tags and following HTML, but this is not a token-aware
source map or a guarantee for every editor/cursor position. Exact raw-body ranges
also let the generic mapping preserve cursor positions inside unchanged fallback
text; tests cover every offset of a representative multiline body.

See [the native Doc design and validation notes](docs/native-docs.md) for details.

### Embedded safety boundaries

Safety and scope:

- Quoted and unquoted `type` attributes are recognized. Scripts are formatted
  only for JavaScript-ish types (no `type`, `text/javascript`, `module`,
  `application/javascript`, `text/babel`, or `application/ecmascript`). A
  `src` attribute disables body formatting. Non-JS `lang` values also fall back.
  Attribute scanning uses HTML's ASCII whitespace rules, not Unicode `\s`.
  An explicit `type` takes precedence over the legacy `language` attribute;
  unsupported legacy languages and whitespace-only type values stay opaque.
- Styles are formatted only with no type or `type="text/css"`, and no language
  or `lang="css"`. Other languages are not sent to the CSS printer.
- JavaScript placeholders must be proven to occur inside ordinary quoted
  string literals. Dynamic property keys stay quoted. Bare expressions,
  Mustache values in template-literal text, and strings with escapes use the fallback
  because a runtime value can change their grammar or interact with escaping.
- Triple/ampersand values, sections, comments, partials, delimiter changes,
  malformed tokens, and interpolated CSS containing escapes also use the
  fallback. Syntax errors or lost/duplicated placeholders do not fail the
  whole file; they leave the body on the same fallback path.
- Fallback preserves source instead of attempting to format the embedded
  language. Raw closing boundaries account for quoted attributes, ASCII tag-name
  delimiters and script's legacy escaped/double-escaped states. Script bodies
  using those HTML escape states remain opaque rather than being rewritten by
  Babel. A complete raw close ends the protected region so following HTML and
  later supported embeddings can still be formatted.

## Scope And Non-Goals

- This is a Mustache formatter, not a Mustache renderer.
- The plugin normalizes Mustache syntax and HTML+Mustache indentation, including nested HTML, multiline tags and attributes, conditional class blocks, partials, comments, tables, void tags, and self-closing tags.
- The plugin formats embedded CSS/JavaScript inside `<style>`/`<script>` blocks with dedicated tag boundaries (see above); other shapes (e.g. a one-line `<script>...</script>`, or a body that isn't valid JS/CSS after guarded substitution) preserve their source.
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
