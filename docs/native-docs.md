# Native Doc printing

Architectural follow-up to [issue #25](https://github.com/Poliklot/prettier-plugin-mustache/issues/25).

## Pipeline

1. `parser.ts` retains the existing Mustache syntax AST in `Program.body` for
   consumers. `source.ts` independently discovers `Program.segments`, the small
   source model used for formatting. Ranges refer to normalized LF source, using
   the same non-enumerable `range` convention as the syntax AST.
2. A `SourceLine` records canonical text, structural depth and whether it follows
   a line boundary. It is not an already-indented multiline output string.
   `VerbatimSource` represents the unchanged unclosed-section fallback.
3. `RawTextBody` records its source range, original text, tag/attributes, depth,
   incoming delimiters and fallback lines. Opening/closing tag lines remain
   separate segments. Discovery processes fallback delimiter transitions before
   scanning following HTML. Embedding cannot change that discovery state.
4. `getVisitorKeys()` exposes only the segment view. Prettier calls `embed()` on
   eligible raw-body nodes; the root does not embed its whole source. The native
   `textToDoc()` call inherits options and caller plugin ordering. Independent
   Babel AST validation does not replace the configured parser or preprocessing.
5. `print()` is synchronous. It combines child Docs via `path.map()`, using
   `indent` and real `hardline` boundaries. Literal lines, groups, alternative
   layouts and line suffixes stay in the Doc until Prettier renders the document.

The line-oriented *outer whitespace policy* is intentionally preserved. This is
not a wholesale HTML parser, newly supported Mustache syntax, or full reflow of
outer prose/attributes. No production function privately renders an embedded Doc.

## Placeholder validation

Safe substitutions use collision-free markers. JS substitutions must be plain
escaped Mustache values inside ordinary, unescaped quoted strings; CSS escapes
still cause fallback when substitutions are present. Structural and unescaped
Mustache fragments are not reinterpreted as identifiers.

`placeholder-doc.ts` restores string leaves and tracks a marker sequence for
concatenation, `fill`, wrappers and mutually exclusive group/`ifBreak` layouts.
Each alternative must preserve the same sequence; each marker must appear once
in the resulting inventory. Alternatives are not summed as simultaneous output.
Restoration does not mutate the delegated Doc or its map, or call a renderer.

Small literal-edge summaries reject marker prefixes assembled across Doc leaves,
including disappearing softlines. Line-suffix reordering uses a conservative
cross-edge check. A cyclic/unknown Doc, text-producing alignment, `trim`, split
markers or differing branch inventories selects fallback. Correlated `ifBreak`
branches are not solved symbolically: some safe custom Docs may conservatively
fall back. An edge-alternative limit bounds pathological custom-printer input,
not the number of ordinary template substitutions.

These checks protect placeholders and the documented grammar subset. They do
not establish program equivalence for arbitrary runtime template values, nor
validate arbitrary transformations made by a caller's own parser/printer.

## Characterization and tests

- `test/fixtures/native-doc-characterization.json` was recorded from 0.2.0 before
  the refactor: boundaries, outer whitespace, blank raw bodies, unclosed input,
  quoted attributes, delimiters, literals and flat/disabled fallbacks.
- The original regression and contributor tests stay enabled. One direct printer
  test now asserts a synchronous Doc and renders it **in the test** to retain its
  exact output assertion, rather than requiring a finished string.
- Native HTML formatting is an independent layout oracle for the supported
  embedded subset. Tests also compare rendered JS results and canonical CSS,
  perform three formatting passes, and cover custom parsers/printers.
- Partial ranges are currently a no-op. Cursor tests characterize the generic
  mapping, including its position before newly inserted Mustache whitespace.
- Stress tests cover 2000 substitutions, 300 raw bodies, and concurrent calls.

Run the usual checks:

```sh
npm run check
npm run corpus:oss
npm run pack:check
npm run smoke:install
```

Run the full test suite against the actual installed tarball instead of the
workspace build (the fixtures are copied only to the temporary test installation,
not added to the published package):

```sh
MUSTACHE_SMOKE_FULL_TESTS=1 MUSTACHE_SMOKE_PRETTIER_VERSION=3.0.0 npm run smoke:install
```

CI exercises installed packages on Node 18/20/22 with current and minimum
Prettier, plus representative intermediate Prettier 3 releases. Tests may use
`doc.printer.printDocToString()` as an oracle; production code may not.
