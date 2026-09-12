# Changelog

## [0.2.1](https://github.com/Poliklot/prettier-plugin-mustache/compare/prettier-plugin-mustache-v0.2.0...prettier-plugin-mustache-v0.2.1) (2026-09-12)

### Refactoring

* Compose ranged Mustache/HTML source segments and child JS/CSS embeddings as one
  native Prettier Doc. Remove intermediate rendering, artificial newline slicing,
  and cloning required solely by intermediate Prettier 3.0 printing.
* Validate placeholder occurrences across alternative layouts before restoration
  and final wrapping. Unsafe custom-printer alternatives now select the source
  fallback instead of being accepted based on one rendered branch.

### Correctness and intentional output changes

* Preserve original raw-body whitespace and Mustache spelling when embedding is
  disabled, unsupported, empty or fails validation. Replace the old flat fallback
  that could change multiline literal values and Mustache lambda input.
* Preserve incomplete/unclosed source including EOF whitespace. Treat inline or
  malformed raw-tag shapes as opaque regions, without consuming following HTML
  past a complete raw close.
* Discover ranged raw elements with child body nodes, including multiline opening
  tags. Protect comments, whitespace-sensitive containers, SVG/MathML fragments,
  ignored raw elements and script's HTML escaped/double-escaped forms.
* Distinguish foreign-element self-closing flags from attribute-value slashes,
  preserve EOF inside unfinished end-tag attributes, and avoid embedding apparent
  script/style tags inside declarations or processing instructions.
* Forward the same HTML/source-type context as Prettier's HTML printer: preserve
  escaped closing tags in nested HTML templates and classic-script `await`
  identifiers instead of reinterpreting them as module expressions.
* Normalize script/style `type` and `lang` whitespace in linear time, avoiding
  quadratic regular-expression backtracking on long attribute values while
  retaining HTML's ASCII-only whitespace rules.

### Compatibility

* Retain ordinary outer-line formatting, Mustache grammar, caller options/plugin
  precedence, Node 18+ and Prettier 3.0+ minimums; no dependencies were added.
* Characterize cursor mapping and the existing partial-range no-op; no new
  syntax-aware editor range-formatting support is claimed.

### Bug Fixes

* normalize HTML attribute whitespace in linear time ([9a46ef8](https://github.com/Poliklot/prettier-plugin-mustache/commit/9a46ef832d64904cb5c52ac5b7cfb2acf2fcd465))
* preserve embedded HTML context and raw tag boundaries ([466dd40](https://github.com/Poliklot/prettier-plugin-mustache/commit/466dd40748a62bcdcb9ecc2ef3dbcbb75c8c176b))
* preserve raw source and harden embedded HTML boundaries ([191cf29](https://github.com/Poliklot/prettier-plugin-mustache/commit/191cf293ba6098c122268fe9eba4fe527e97bbfd))

## [0.2.0](https://github.com/Poliklot/prettier-plugin-mustache/compare/prettier-plugin-mustache-v0.1.6...prettier-plugin-mustache-v0.2.0) (2026-09-11)


### Features

* format embedded &lt;script&gt;/&lt;style&gt; content with babel/css ([c7f9517](https://github.com/Poliklot/prettier-plugin-mustache/commit/c7f9517a9a8430fec8f6453fa283c2e8923f72bb))


### Bug Fixes

* base embedded wrap decisions on restored width, tighten safety ([4c8b719](https://github.com/Poliklot/prettier-plugin-mustache/commit/4c8b71972e816222d400835233b7147f7804f54a))
* don't re-indent verbatim continuation lines in embedded code ([10108cc](https://github.com/Poliklot/prettier-plugin-mustache/commit/10108ccdff95c0dea444510a4e0af3354390dca0))
* safely format embedded script and style bodies ([da81980](https://github.com/Poliklot/prettier-plugin-mustache/commit/da8198051395dcbfe2c2aa0e47c18d78ed123ec1))

## [0.1.6](https://github.com/Poliklot/prettier-plugin-mustache/compare/prettier-plugin-mustache-v0.1.5...prettier-plugin-mustache-v0.1.6) (2026-08-11)


### Bug Fixes

* **ci:** support trusted manual npm publishing ([f89c6fb](https://github.com/Poliklot/prettier-plugin-mustache/commit/f89c6fb10816c69322b2e8d2892abc3f30e9c394))

## [0.1.5](https://github.com/Poliklot/prettier-plugin-mustache/compare/prettier-plugin-mustache-v0.1.4...prettier-plugin-mustache-v0.1.5) (2026-07-27)

### Bug Fixes

* update TypeScript, Prettier, and Node.js development types

## [0.1.4](https://github.com/Poliklot/prettier-plugin-mustache/compare/v0.1.3...prettier-plugin-mustache-v0.1.4) (2026-06-29)

### Bug Fixes

* preserve HTML indentation in Mustache templates ([#11](https://github.com/Poliklot/prettier-plugin-mustache/pull/11)), closes [#5](https://github.com/Poliklot/prettier-plugin-mustache/issues/5)

## 0.1.3 - 2026-06-04

- Added fuzz, local corpus, OSS corpus, install-smoke, semantic render-equivalence, and mined real-world pattern checks.
- Added `mustache` as a development renderer dependency for render-equivalence coverage.
- Expanded `check` to include deterministic fuzz coverage in addition to build and unit tests.
- Added CI install-smoke coverage for packed tarballs.

## 0.1.2 - 2026-06-03

- Added `.mst` and `.mu` file extensions for parser inference in editors and Prettier CLI usage.
- Respected Prettier `tabWidth` and `useTabs` when indenting multiline sections, parents, and blocks.
- Added coverage for standalone comments, partials, delimiter tags, delimiter changes inside multiline sections, and Mustache keys with punctuation such as `person?`.
- Documented supported file extensions and Prettier indentation behavior.

## 0.1.1 - 2026-06-03

- Expanded README with install/configuration examples, syntax coverage, formatting behavior, scope, and development notes.
- Added Mustache spec-oriented tests for dotted names, implicit iterators, multiline sections, multiline comments, dynamic partials, dynamic parents, delimiter resets, and delimiter changes inside sections.
- Preserved inline sections during formatting to avoid introducing Mustache-significant whitespace.
- Preserved leading root whitespace while still normalizing the final newline.

## 0.1.0 - 2026-06-03

- Initial public release.
- Added Mustache parser and printer built on `template-format-core`.
- Added support for variables, comments, partials, sections, inverted sections, inheritance blocks/parents, delimiter changes, tests, documentation, and CI.
