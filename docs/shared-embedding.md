# Shared safe embedding

| Repository | Tracking issue | Role |
|---|---|---|
| template-format-core | [#2](https://github.com/Poliklot/template-format-core/issues/2) | Shared safety API, merge/release first |
| prettier-plugin-mustache | [#29](https://github.com/Poliklot/prettier-plugin-mustache/issues/29) | Extract proven mechanisms; preserve 0.2.1 output |
| prettier-plugin-nunjucks | [#26](https://github.com/Poliklot/prettier-plugin-nunjucks/issues/26) | Nunjucks adapter and runtime regressions |
| prettier-plugin-handlebars | [#81](https://github.com/Poliklot/prettier-plugin-handlebars/issues/81) | Handlebars adapter and runtime regressions |

Each repository uses its own `refactor/shared-safe-embedding` branch. Consumer PRs must remain draft until core is reviewed, published, and their dependency points to the published registry version. A candidate source pin is for integration testing, not a final release dependency. No merge or publication is implied by green local tests.

## API boundary

`template-format-core` keeps its root exports independent of Prettier at runtime. Range helpers, attribute classification, protected HTML boundaries, and placeholder planning remain usable without the optional Prettier peer.

`template-format-core/prettier` is an explicitly opt-in Prettier 3 adapter: it imports the caller's Prettier/Babel implementation, validates quoted JS substitution sites, rejects unsafe CSS escapes, delegates through the native `textToDoc` callback, validates every relevant alternative Doc layout, and returns a Doc or `null` for exact-source fallback. It never renders a Doc privately. `sourceToDoc` preserves LF-normalized source using literal lines; it does not strip edge newlines, trim strings or invent indentation.

The internal `__embeddedInHtml` and `__babelSourceType` flags are explicit compatibility dependencies, mirroring Prettier's HTML adapter. They are not public user options. They reach independent AST validation and native delegation without replacing user parsers or preprocessing. The adapter does not prove the correctness of arbitrary transformations performed by a custom caller parser/printer.

## Dialects and HTML

The plugin owns its AST, tokenizer and rules for eligible template substitutions. Core accepts sorted, non-overlapping source spans and already classified values; it does not turn Nunjucks statements or Handlebars helpers into Mustache. Structural tags, unescaped fragments, whitespace-control tags, incomplete delimiters, escapes and unsupported contexts must remain conservative fallback cases.

Core creates source/replacement-collision-free, case-stable markers and restores them in a single pass. JS markers contain a hyphen so printers cannot remove required dynamic-key quotes. Each layout alternative must retain the same marker inventory; dropped/duplicated/split markers and unknown/cyclic Docs select fallback. Correlated branches and pathological custom Doc edge sets are deliberately conservative, not a symbolic renderer.

HTML boundary readers preserve quoted end-tag attributes and script escaped/double-escaped states. They are source-boundary primitives, not a browser tree-repair algorithm. The complete `discoverProtectedRegions` API accepts explicit protected template spans. The existing Nunjucks/Handlebars parsers reuse raw-close readers without replacing their whole HTML AST or claiming all Mustache foreign-container behavior.

Language classification distinguishes missing attributes from unknown/dynamic values. Only HTML's five ASCII whitespace characters are removed, using linear edge scans. Dynamic/conditional attribute blocks cannot silently select default JS. JSON, unsupported type/lang, external src and ambiguous contexts retain source.

## Validation and release gates

- Preserve real template-rendered JS results and canonical CSS, not only idempotence.
- Keep caller plugins/preprocessing, options, EOL, Doc alternatives, literals, comments, stress/concurrency and supported Node/Prettier combinations covered.
- Review intentional fallback differences; do not bulk-update corpus/snapshots.
- Validate the actual packed core and plugins together, plus CommonJS and declaration consumption.
- Core first; then publish and update consumer dependencies/locks before marking consumer PRs ready. Keep package publishing under each repository's AGENTS.md rules.

Mustache retains its dialect-specific normalization and source discovery. The extraction must retain its reviewed 0.2.1 corpus output and regressions.

## Quote style and runtime values

Nunjucks/Handlebars adapters additionally keep dynamic JS strings in their original quote style: if the requested `singleQuote` preference conflicts, the body remains source rather than moving an unknown runtime value between quote contexts. This is an opt-in core policy; the Mustache extraction retains its existing 0.2.1 policy. The formatter is not an escaping/validation layer for arbitrary runtime values, custom helpers, lambdas, or CSS produced dynamically. Input escaping and runtime correctness remain the template author's responsibility.

## Integration candidate

Depends on [template-format-core PR #3](https://github.com/Poliklot/template-format-core/pull/3), pinned to commit `a4c907e5f69edf1444d57caa2c690650e5d197ff` over HTTPS in package.json and package-lock.json. This is an integration-only source dependency. Keep this consumer PR in draft until core is reviewed and published, then replace the pin with that registry version and re-run installation, tests and package smoke checks. The prepublish guard rejects the source pin.
