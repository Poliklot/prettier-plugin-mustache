import { doc } from 'prettier';
import type { Doc, Options, ParserOptions } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';

export type TextToDoc = (text: string, options: Options) => Promise<Doc>;

// Only quoted JS strings are safe substitution sites. In particular, an
// unescaped Mustache value can be an arbitrary expression, not an identifier.
// Let the actual parser establish lexical context instead of approximating
// strings, regular expressions, or nested template literals with a scanner.
function placeholdersAreStrings(ast: unknown, placeholders: Map<string, string>): boolean {
  const remaining = new Set(placeholders.keys());
  const visited = new Set<object>();
  function visit(value: unknown): void {
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return;
    }
    visited.add(value);
    const node = value as Record<string, unknown>;
    const extra = node.extra as { raw?: unknown } | undefined;
    if (
      node.type === 'StringLiteral' &&
      typeof node.value === 'string' &&
      typeof extra?.raw === 'string' &&
      !extra.raw.includes('\\')
    ) {
      for (const placeholder of remaining) {
        if (node.value.includes(placeholder)) {
          remaining.delete(placeholder);
        }
      }
    }
    for (const child of Object.values(node)) {
      visit(child);
    }
  }
  visit(ast);
  return remaining.size === 0;
}

export async function formatEmbeddedDoc(
  text: string,
  restore: Map<string, string>,
  parser: 'babel' | 'css',
  depth: number,
  options: Options,
  textToDoc: TextToDoc,
): Promise<string | null> {
  try {
    // CSS escapes can interact with an unknown value across the substitution
    // boundary. Unlike plain identifiers, they are not safe opaque markers.
    if (parser === 'css' && restore.size > 0 && text.includes('\\')) {
      return null;
    }
    if (parser === 'babel' && restore.size > 0) {
      // Validate separately: replacing the Babel parser in textToDoc would
      // silently bypass the caller's parser, preprocessing, and plugin order.
      // embed() types options as partial, but Prettier supplies resolved values.
      const ast = await babelParsers.babel.parse(text, {
        ...options,
        parser: 'babel',
        originalText: text,
        locStart: babelParsers.babel.locStart,
        locEnd: babelParsers.babel.locEnd,
      } as ParserOptions);
      if (!placeholdersAreStrings(ast, restore)) {
        return null;
      }
    }

    // textToDoc inherits the resolved user options, but resets parent source
    // ranges/cursor state. Do not call format() with a hand-picked option list.
    let bodyDoc = await textToDoc(text, { parser });
    bodyDoc = [doc.builders.hardline, bodyDoc];
    for (let level = 0; level < depth; level += 1) {
      bodyDoc = doc.builders.indent(bodyDoc);
    }

    // Use real Doc indentation, including literal-line semantics. The initial
    // hardline also makes tabWidth count correctly on the body's first line.
    // Render only this embedded block: the existing outer formatter is still
    // line-based and does not need a new HTML AST.
    const printOptions = {
      printWidth: options.printWidth ?? 80,
      tabWidth: options.tabWidth ?? 2,
      useTabs: options.useTabs ?? false,
    };
    // Older Prettier 3 versions consume fill.parts while printing. Render a
    // cloned Doc on each pass, or validation itself can delete later tokens.
    const render = (value: Doc) => {
      const copy = doc.utils.mapDoc([value, doc.builders.hardline], (part) => part);
      return doc.printer.printDocToString(copy, printOptions).formatted.slice(1, -1);
    };
    const rendered = render(bodyDoc);

    // Accept neither dropped nor duplicated tokens, even if the delegated
    // parser/another plugin returned successfully.
    for (const placeholder of restore.keys()) {
      if (rendered.split(placeholder).length !== 2) {
        return null;
      }
    }
    if (restore.size === 0) {
      return rendered;
    }
    // Generated markers contain only letters, digits, underscores, and a
    // hyphen. One replacement pass cannot rewrite a restored token's contents.
    const pattern = new RegExp([...restore.keys()].join('|'), 'g');
    const restoredDoc = doc.utils.mapDoc(bodyDoc, (part) =>
      typeof part === 'string' ? part.replace(pattern, (placeholder) => restore.get(placeholder)!) : part,
    );
    // Restore before making final layout decisions, so even short custom
    // delimiters or many tokens wrap at their real width, not a marker's width.
    const restored = render(restoredDoc);
    return [...restore.keys()].some((placeholder) => restored.includes(placeholder)) ? null : restored;
  } catch {
    return null;
  }
}
