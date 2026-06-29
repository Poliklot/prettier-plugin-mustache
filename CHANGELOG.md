# Changelog

## Unreleased

- Added HTML+Mustache indentation formatting for nested HTML, multiline attributes, section-wrapped markup, parent/block templates, custom delimiters, comments, partials, self-closing tags, and tab indentation.
- Added regression coverage for GitHub issue #5 and related HTML-heavy Mustache templates.

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
