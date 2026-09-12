import { doc } from 'prettier';
import type { Doc, Printer } from 'prettier';
import { formatEmbeddedDoc } from './embedded';
import { discoverSource, extractMustachePlaceholders, resolveEmbeddedParser } from './source';
import type { Node, SourceSegment } from './types';

const { hardline, indent, join, literalline } = doc.builders;

function atDepth(contents: Doc, depth: number): Doc {
  for (let level = 0; level < depth; level += 1) contents = indent(contents);
  return contents;
}

function printFallback(node: SourceSegment): Doc {
  switch (node.type) {
    case 'SourceLine':
      return atDepth([node.leadingLine ? hardline : '', node.text], node.depth);
    case 'RawTextBody':
      return node.fallback.map(printFallback);
    case 'VerbatimSource':
      return join(literalline, node.text.split('\n'));
  }
}

export const printer: Printer<Node> = {
  getVisitorKeys(node) {
    // The syntax AST remains available to consumers. Embedding/printing visit
    // only source segments, never a second copy of the same Mustache content.
    return node.type === 'Program' ? ['segments'] : [];
  },
  embed(path, options) {
    const node = path.node;
    if (node.type !== 'RawTextBody' || !node.text.trim()) return null;
    const parser = resolveEmbeddedParser(node.tag, node.attrsText);
    if (!parser) return null;
    const extracted = extractMustachePlaceholders(node.text, node.delimiters);
    if (!extracted) return null;

    return async (textToDoc) => {
      const contents = await formatEmbeddedDoc(extracted.text, extracted.restore, parser, options, textToDoc);
      // This hardline is the actual opening-tag/body boundary, not a sentinel
      // for a private renderer. Literal lines and suffix comments remain Docs.
      return contents === null ? printFallback(node) : atDepth([hardline, contents], node.depth);
    };
  },
  print(path, _options, print): Doc {
    const node = path.getValue();
    if (!node) return '';
    if (node.type === 'Program') {
      const segments = node.segments ?? discoverSource(node.source ?? '');
      if (!segments.length) return '';
      // The fallback also supports direct synchronous printer calls. Normal
      // Prettier calls use path.map so child embed Docs are composed unchanged.
      return [node.segments ? path.map(print, 'segments') : segments.map(printFallback), hardline];
    }
    if (node.type === 'SourceLine' || node.type === 'RawTextBody' || node.type === 'VerbatimSource') {
      return printFallback(node);
    }
    return '';
  },
};
