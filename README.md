# prettier-plugin-mustache

Prettier plugin for Mustache templates.

## Install

```sh
npm install --save-dev prettier prettier-plugin-mustache
```

## Usage

Prettier loads plugins from config:

```json
{
  "plugins": ["prettier-plugin-mustache"]
}
```

Then format `.mustache` files:

```sh
npx prettier --write "**/*.mustache"
```

## Supported syntax

- variables: `{{name}}`
- unescaped variables: `{{{name}}}` and `{{& name}}`
- comments: `{{! comment}}`
- partials: `{{> user}}`
- sections: `{{#items}}...{{/items}}`
- inverted sections: `{{^items}}...{{/items}}`
- parent templates: `{{< layout}}...{{/layout}}`
- block overrides: `{{$title}}...{{/title}}`
- delimiter changes: `{{=<% %>=}}`

## Notes

This package focuses on Mustache syntax. It does not claim Handlebars or Ember/Glimmer compatibility; use `@poliklot/prettier-plugin-handlebars` for classic Handlebars.

## Release

Publishing is manual:

```sh
npm publish --access public
```
