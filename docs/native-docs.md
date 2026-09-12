# Native Doc printing

Architectural follow-up to [issue #25](https://github.com/Poliklot/prettier-plugin-mustache/issues/25).

## Pipeline

1. `parser.ts` retains the existing Mustache syntax AST in `Program.body` for
   consumers. `source.ts` independently discovers `Program.segments`, the small
   source model used for formatting. Ranges refer to normalized LF source, using
   the same non-enumerable `range` convention as the syntax AST.
2. `raw-regions.ts` discovers protected boundaries before line formatting. It skips
   Mustache token spans and quoted HTML attributes, recognizes raw close names,
   and tracks script's escaped/double-escaped states. Comments, whitespace-sensitive
   containers and foreign fragments are opaque; explicit nested containers are
   balanced. This follows the relevant [HTML tokenization rules](https://html.spec.whatwg.org/multipage/parsing.html#script-data-state),
   not the complete browser tree-building/repair algorithm.
   Tag boundaries distinguish actual self-closing flags from slashes in unquoted
   values; EOF in a quoted attribute is not a completed tag. Apparent tags inside
   markup declarations (through `>`) and named processing instructions (through
   `?>` or EOF) are excluded from discovery, without claiming a full instruction
   parser or changing ordinary outer-line formatting of PHP/XML templates.
3. `RawTextElement` owns its original opening tag, closing tag and a child
   `RawTextBody`. Body ranges cover **every character** between the tags, including
   boundary newlines and closing-tag indentation. Multiline opening tags retain
   internal attribute spelling/whitespace. `OpaqueSource` protects complete source
   regions; `VerbatimSource` protects incomplete/unclosed Mustache input. Ordinary
   outer `SourceLine` nodes retain canonical text and structural depth.
4. `getVisitorKeys()` exposes only the segment view and raw-element body children. Prettier calls `embed()` on
   eligible raw-body nodes; the root does not embed its whole source. The native
   `textToDoc()` call inherits options and caller plugin ordering. Independent
   Babel AST validation does not replace the configured parser or preprocessing.
   The adapter forwards Prettier's internal `__embeddedInHtml` and
   `__babelSourceType` context flags, as its own HTML printer does. These are
   explicit, version-tested compatibility dependencies, not public user options:
   omitting them can unescape nested `</script>` tags or reinterpret a classic
   script's `await` identifier as module syntax. No private renderer is used.
5. `print()` is synchronous. It combines child Docs via `path.map()`, using
   `indent` and real `hardline` boundaries. Literal lines, groups, alternative
   layouts and line suffixes stay in the Doc until Prettier renders the document.

The line-oriented *outer whitespace policy* is intentionally preserved. This is
not a wholesale HTML parser, newly supported Mustache syntax, or full reflow of
outer prose/attributes. No production function privately renders an embedded Doc.

## Source-preserving fallback (intentional change from 0.2.0)

The original native-Doc checkpoint preserved 0.2.0's flat fallback. Additional
semantic tests demonstrated that trimming/reindenting its lines changed JS/CSS
literal values, and normalizing template spelling changed lambda input. The
follow-up replaces that policy rather than merely documenting those failures.

When embedding is disabled, unsupported, empty or rejected, the body is emitted
with literal-line Docs from its exact source slice. No Mustache normalization,
dedent, trim or artificial boundary newline is applied. Closing indentation is
part of that slice and is retained. An accepted embedded Doc instead owns native
opening/body and body/closing line boundaries. EOL conversion remains Prettier's
responsibility. Incomplete/unclosed regions keep their EOF whitespace.

Delimiter tokens are scanned without rendering/normalizing text, regardless of
embedding success. Their state is applied to subsequent source. Opaque-region
contents never contribute HTML indentation depth. An adjacent HTML
`prettier-ignore` comment protects the next raw element. Inline raw elements are
not expanded or reformatted speculatively; protected regions sharing a physical
line are kept together to avoid inventing significant inline whitespace.
The indentation before a standalone protected opening (or a single-line opaque
region) is outside its contents and can follow normal outer indentation. The
original source slice/range remains available for cursor mapping.

This is a stronger fallback guarantee, not proof of equivalent behavior for every
possible runtime-generated program, lambda or HTML tree. Existing outer-line
formatting remains outside that guarantee.

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
- The original regression and contributor tests stay enabled. Exact fallback
  expectations now require original source, not legacy flat indentation. The
  frozen 0.2.0 fixture is unchanged; its test explicitly applies only reviewed
  raw-source/EOF deltas and retains all other expected bytes. A direct printer
  test asserts a synchronous Doc and renders it **in the test**.
- Native HTML formatting is an independent layout oracle for the supported
  embedded subset. Tests also compare rendered JS results and canonical CSS,
  perform three formatting passes, and cover custom parsers/printers.
- Partial ranges are currently a no-op. Cursor tests characterize the generic
  mapping, including its position before newly inserted Mustache whitespace;
  every cursor offset of a multiline fallback body retains its source-relative
  position.
- Raw-source tests compare exact whitespace, rendered JS values, lambda input,
  delimiter transitions, failures and all EOL modes. Boundary regressions cover
  multiline/quoted attributes, comments, pre/textarea/foreign containers, inline
  and malformed closes, EOF preservation, ignore comments and overlapping HTML
  script escape transitions. Additional regressions cover unfinished end-tag
  attributes, foreign-container self-closing flags, declarations and instructions.
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
