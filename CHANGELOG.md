# Changelog

## 0.1.1 - 2026-06-03

- Expanded README with install/configuration examples, syntax coverage, formatting behavior, scope, and development notes.
- Added Mustache spec-oriented tests for dotted names, implicit iterators, multiline sections, multiline comments, dynamic partials, dynamic parents, delimiter resets, and delimiter changes inside sections.
- Preserved inline sections during formatting to avoid introducing Mustache-significant whitespace.
- Preserved leading root whitespace while still normalizing the final newline.

## 0.1.0 - 2026-06-03

- Initial public release.
- Added Mustache parser and printer built on `template-format-core`.
- Added support for variables, comments, partials, sections, inverted sections, inheritance blocks/parents, delimiter changes, tests, documentation, and CI.
