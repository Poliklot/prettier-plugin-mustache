import type { Doc, Options, ParserOptions } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { restorePlaceholderDoc } from './placeholder-doc';

export type TextToDoc = (text: string, options: Options) => Promise<Doc>;

// Only quoted JS strings are safe substitution sites. In particular, an
// unescaped Mustache value can be an arbitrary expression, not an identifier.
// Let the actual parser establish lexical context instead of approximating
// strings, regular expressions, or nested template literals with a scanner.
function placeholdersAreStrings(ast: unknown, placeholders: Map<string, string>): boolean {
  const remaining = new Set(placeholders.keys());
  const pattern = new RegExp([...placeholders.keys()].join('|'), 'g');
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
      for (const match of node.value.matchAll(pattern)) remaining.delete(match[0]);
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
  options: Options,
  textToDoc: TextToDoc,
): Promise<Doc | null> {
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
    const bodyDoc = await textToDoc(text, { parser });
    return restorePlaceholderDoc(bodyDoc, restore);
  } catch {
    return null;
  }
}
