# Changelog

## Unreleased

### Refactoring

* Compose ranged Mustache/HTML source segments and child JS/CSS embeddings as one
  native Prettier Doc. Remove intermediate rendering, artificial newline slicing,
  and cloning required solely by intermediate Prettier 3.0 printing.
* Validate placeholder occurrences across alternative layouts before restoration
  and final wrapping. Unsafe custom-printer alternatives now select the existing
  fallback instead of being accepted based on one rendered branch.

### Compatibility

* Retain the existing outer formatting and flat fallback policy, supported syntax,
  caller options/plugin precedence, Node 18+ and Prettier 3.0+ minimums.
* Characterize cursor mapping and the existing partial-range no-op; no new
  syntax-aware editor range-formatting support is claimed.

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
