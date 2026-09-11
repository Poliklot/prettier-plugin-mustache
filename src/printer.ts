import type { AstPath, Doc, Options, ParserOptions, Printer } from 'prettier';
import { isTemplateExpressionQuoteStart, parseTemplateExpression, voidElements } from 'template-format-core';
import { formatEmbeddedDoc, type TextToDoc } from './embedded';
import type {
  CommentStatement,
  DelimiterStatement,
  MustacheStatement,
  Node,
  PartialStatement,
  Program,
  SectionStatement,
} from './types';

interface PrintContext {
  indentation: string;
}

interface Delimiters {
  open: string;
  close: string;
}

type RawTextTag = 'script' | 'style';

// Script types whose body is still plain JavaScript. Anything else (JSON
// islands, other templating languages sharing the file, etc.) is left to the
// existing flat-indent fallback rather than risking a confidently wrong
// reformat.
const JS_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/babel', 'application/ecmascript']);

interface PendingRawTextElement {
  tag: RawTextTag;
  baseDepth: number;
  attrsText: string;
  lines: string[];
}

interface RawTextRequest {
  element: PendingRawTextElement;
  delimiters: Delimiters;
}

type TemplateTokenKind = 'mustache' | 'partial' | 'comment' | 'sectionStart' | 'sectionEnd' | 'delimiter';

interface TemplateToken {
  kind: TemplateTokenKind;
  raw: string;
  content: string;
  start: number;
  end: number;
  open: string;
  close: string;
  triple: boolean;
  ampersand: boolean;
  sectionKind?: 'section' | 'inverted' | 'parent' | 'block';
  name?: string;
  nextOpen?: string;
  nextClose?: string;
}

interface PendingOpenTag {
  tag: string;
  baseDepth: number;
}

interface PendingAttributeValue {
  quote: '"' | "'";
  tagBaseDepth: number;
  valueBaseDepth: number;
}

export const printer: Printer<Node> = {
  embed(path, options) {
    const node = path.node;
    if (!node || node.type !== 'Program' || typeof node.source !== 'string') {
      return null;
    }

    // The source formatter can remain line-based: only the root needs an
    // asynchronous embed hook. print() itself always returns a synchronous Doc.
    return async (textToDoc) => {
      const source = formatSource(node.source, options);
      let step = source.next();
      while (!step.done) {
        const { element, delimiters } = step.value;
        const body = await formatEmbeddedRawText(element, createPrintContext(options), options, delimiters, textToDoc);
        step = source.next(body);
      }
      return step.value;
    };
  },
  print(path: AstPath<Node>, options: ParserOptions<Node>): Doc {
    const node = path.getValue();

    if (!node) {
      return '';
    }

    const context = createPrintContext(options);

    if (node.type === 'Program') {
      if (typeof node.source === 'string') {
        // Prettier skips embed() when embeddedLanguageFormatting is off.
        const source = formatSource(node.source, options);
        let step = source.next();
        while (!step.done) {
          const { element, delimiters } = step.value;
          step = source.next(formatRawTextFallback(element.lines, element.baseDepth, context, delimiters));
        }
        return step.value;
      }

      return formatProgram(node, context);
    }

    return printNode(node, context);
  },
  getVisitorKeys() {
    return [];
  },
};

function createPrintContext(options: Options): PrintContext {
  return {
    indentation: options.useTabs ? '\t' : ' '.repeat(options.tabWidth ?? 2),
  };
}

function* formatSource(source: string, options: Options): Generator<RawTextRequest, string, string[]> {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (normalized.trim().length === 0) {
    return '';
  }

  if (hasUnclosedSection(normalized)) {
    return `${normalized.trimEnd()}\n`;
  }

  const context = createPrintContext(options);
  const withoutFinalNewline = normalized.replace(/\n+$/g, '');
  const lines = withoutFinalNewline.split('\n');

  if (lines.length === 1) {
    const delimiters = createDefaultDelimiters();
    const formatted = normalizeMustacheInText(lines[0].replace(/[ \t]+$/g, ''), delimiters).text.trimEnd();
    return formatted.length > 0 ? `${formatted}\n` : '';
  }

  const rawTextCloseLines = findRawTextCloseLines(lines);

  const state = {
    depth: 0,
    delimiters: createDefaultDelimiters(),
    pendingOpenTag: undefined as PendingOpenTag | undefined,
    pendingAttributeValue: undefined as PendingAttributeValue | undefined,
    rawTextElement: undefined as PendingRawTextElement | undefined,
  };
  const output: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const rawTrimmed = rawLine.trim();

    if (state.rawTextElement) {
      if (matchesRawTextCloseTag(rawTrimmed, state.rawTextElement.tag)) {
        const formattedBody = yield { element: state.rawTextElement, delimiters: state.delimiters };
        output.push(...formattedBody);
        output.push(`${context.indentation.repeat(state.rawTextElement.baseDepth)}${rawTrimmed}`);
        state.depth = state.rawTextElement.baseDepth;
        state.rawTextElement = undefined;
        continue;
      }

      state.rawTextElement.lines.push(rawLine);
      continue;
    }

    if (rawTrimmed.length === 0) {
      output.push('');
      continue;
    }

    const lineStartDelimiters = cloneDelimiters(state.delimiters);
    const standaloneToken = parseStandaloneToken(rawTrimmed, lineStartDelimiters);
    const normalizedLine = normalizeMustacheInText(rawTrimmed, state.delimiters).text.trim();

    if (state.pendingAttributeValue) {
      if (standaloneToken?.kind === 'sectionEnd') {
        state.depth = Math.max(state.pendingAttributeValue.tagBaseDepth, state.depth - 1);
      }

      const isAttributeClose = isAttributeValueCloseLine(normalizedLine, state.pendingAttributeValue.quote);
      const relativeDepth = Math.max(state.depth - state.pendingAttributeValue.tagBaseDepth, 0);
      const indentDepth = isAttributeClose
        ? state.pendingAttributeValue.tagBaseDepth + 1
        : state.pendingAttributeValue.valueBaseDepth + relativeDepth;

      output.push(`${context.indentation.repeat(indentDepth)}${normalizedLine}`);

      if (standaloneToken?.kind === 'sectionStart') {
        state.depth += 1;
      }

      if (isAttributeClose) {
        state.pendingAttributeValue = undefined;
      }

      continue;
    }

    if (state.pendingOpenTag) {
      const closesPendingTag = closesPendingOpenTag(normalizedLine);
      const closesWithOnlyBracket = isOnlyTagCloseLine(normalizedLine);
      const closesPendingElement = closesPendingElementOnSameLine(normalizedLine, state.pendingOpenTag.tag);
      const indentDepth =
        closesWithOnlyBracket || closesPendingElement ? state.pendingOpenTag.baseDepth : state.pendingOpenTag.baseDepth + 1;

      output.push(`${context.indentation.repeat(indentDepth)}${normalizedLine}`);

      if (startsMultilineAttributeValue(normalizedLine)) {
        state.pendingAttributeValue = {
          quote: getMultilineAttributeQuote(normalizedLine) ?? '"',
          tagBaseDepth: state.pendingOpenTag.baseDepth,
          valueBaseDepth: state.pendingOpenTag.baseDepth + 2,
        };
      }

      if (closesPendingTag) {
        const nextDepth =
          isSelfClosingTagLine(normalizedLine) ||
          closesPendingElement ||
          voidElements.has(state.pendingOpenTag.tag.toLowerCase())
            ? state.pendingOpenTag.baseDepth
            : state.pendingOpenTag.baseDepth + 1;
        state.depth = nextDepth;
        state.pendingOpenTag = undefined;
        state.pendingAttributeValue = undefined;
      }

      continue;
    }

    if (standaloneToken?.kind === 'sectionEnd') {
      state.depth = Math.max(0, state.depth - 1);
    }

    const leadingCloseCount = countLeadingHtmlCloseTags(normalizedLine);
    if (leadingCloseCount > 0) {
      state.depth = Math.max(0, state.depth - leadingCloseCount);
    }

    const indentDepth = state.depth;
    output.push(`${context.indentation.repeat(indentDepth)}${normalizedLine}`);

    if (standaloneToken?.kind === 'sectionStart') {
      state.depth += 1;
    }

    const multilineOpenTag = getMultilineOpenTag(normalizedLine);
    if (multilineOpenTag) {
      state.pendingOpenTag = {
        tag: multilineOpenTag,
        baseDepth: indentDepth,
      };

      if (startsMultilineAttributeValue(normalizedLine)) {
        state.pendingAttributeValue = {
          quote: getMultilineAttributeQuote(normalizedLine) ?? '"',
          tagBaseDepth: indentDepth,
          valueBaseDepth: indentDepth + 2,
        };
      }

      continue;
    }

    const rawTextOpenTag = matchRawTextOpenTag(normalizedLine);
    const closeLine = rawTextOpenTag ? rawTextCloseLines[rawTextOpenTag.tag][lineIndex] : -1;
    if (rawTextOpenTag && closeLine >= 0 && matchesRawTextCloseTag(lines[closeLine].trim(), rawTextOpenTag.tag)) {
      state.rawTextElement = {
        tag: rawTextOpenTag.tag,
        baseDepth: indentDepth,
        attrsText: rawTextOpenTag.attrsText,
        lines: [],
      };
      continue;
    }

    const htmlDepthDelta = getHtmlDepthDelta(normalizedLine, leadingCloseCount);
    state.depth = Math.max(0, state.depth + htmlDepthDelta);
  }

  return `${output.join('\n').trimEnd()}\n`;
}

async function formatEmbeddedRawText(
  element: PendingRawTextElement,
  context: PrintContext,
  options: Options,
  delimiters: Delimiters,
  textToDoc: TextToDoc,
): Promise<string[]> {
  const fallback = () => formatRawTextFallback(element.lines, element.baseDepth, context, delimiters);
  const parserName = resolveEmbeddedParser(element.tag, element.attrsText);
  const bodyText = element.lines.join('\n');

  if (!parserName || bodyText.trim().length === 0) {
    return fallback();
  }

  const extracted = extractMustachePlaceholders(bodyText, delimiters);
  if (!extracted) {
    return fallback();
  }

  const formatted = await formatEmbeddedDoc(
    extracted.text,
    extracted.restore,
    parserName,
    element.baseDepth + 1,
    options,
    textToDoc,
  );
  return formatted === null ? fallback() : formatted.split('\n');
}

function formatRawTextFallback(bodyLines: string[], baseDepth: number, context: PrintContext, delimiters: Delimiters): string[] {
  const indentPrefix = context.indentation.repeat(baseDepth + 1);
  return bodyLines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return '';
    }

    const normalized = normalizeMustacheInText(trimmed, delimiters).text.trim();
    return `${indentPrefix}${normalized}`;
  });
}

function resolveEmbeddedParser(tag: RawTextTag, attrsText: string): 'babel' | 'css' | null {
  const attributes = parseRawTextAttributes(attrsText);
  if (!attributes) {
    return null;
  }

  const type = (attributes.get('type') ?? '').trim().toLowerCase();
  const lang = (attributes.get('lang') ?? '').trim().toLowerCase();
  if (tag === 'style') {
    return (!type || type === 'text/css') && (!lang || lang === 'css') ? 'css' : null;
  }
  if (attributes.has('src') || (lang && !['js', 'javascript'].includes(lang))) {
    return null;
  }
  return JS_SCRIPT_TYPES.has(type) ? 'babel' : null;
}

function parseRawTextAttributes(text: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let position = 0;
  while (position < text.length) {
    const whitespace = text.slice(position).match(/^\s+/);
    if (!whitespace) {
      return null;
    }
    position += whitespace[0].length;
    if (position === text.length) {
      break;
    }

    const nameMatch = text.slice(position).match(/^[^\s=/<>"'`]+/);
    if (!nameMatch) {
      return null;
    }
    const name = nameMatch[0].toLowerCase();
    position += nameMatch[0].length;
    const afterName = position;
    position += text.slice(position).match(/^\s*/)?.[0].length ?? 0;

    let value = '';
    if (text[position] === '=') {
      position += 1;
      position += text.slice(position).match(/^\s*/)?.[0].length ?? 0;
      const quote = text[position];
      if (quote === '"' || quote === "'") {
        const end = text.indexOf(quote, position + 1);
        if (end === -1) {
          return null;
        }
        value = text.slice(position + 1, end);
        position = end + 1;
      } else {
        const valueMatch = text.slice(position).match(/^[^\s<>"'`=]+/);
        if (!valueMatch) {
          return null;
        }
        value = valueMatch[0];
        position += value.length;
      }
    } else {
      // Leave the separator for the next attribute to consume.
      position = afterName;
    }
    // HTML uses the first occurrence of a duplicate attribute.
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function matchRawTextOpenTag(line: string): { tag: RawTextTag; attrsText: string } | null {
  const match = line.match(/^<(script|style)(\s[\s\S]*|)>$/i);
  if (!match || /\/\s*$/.test(match[2]) || !parseRawTextAttributes(match[2])) {
    return null;
  }
  return { tag: match[1].toLowerCase() as RawTextTag, attrsText: match[2] };
}

function matchesRawTextCloseTag(line: string, tag: RawTextTag): boolean {
  return new RegExp(`^<\\/${tag}\\s*>$`, 'i').test(line);
}

function findRawTextCloseLines(lines: string[]): Record<RawTextTag, number[]> {
  const result: Record<RawTextTag, number[]> = { script: [], style: [] };
  for (const tag of ['script', 'style'] as const) {
    const close = new RegExp(`<\\/${tag}(?=[\\s/>])`, 'i');
    let next = -1;
    // Cache the first later close in linear time, including unsupported inline
    // closes. They terminate HTML raw text even when inside a JS string, and
    // must prevent the embedded buffer from consuming subsequent HTML.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      result[tag][index] = next;
      if (close.test(lines[index])) {
        next = index;
      }
    }
  }
  return result;
}

function extractMustachePlaceholders(
  text: string,
  delimiters: Delimiters,
): { text: string; restore: Map<string, string> } | null {
  const tokens: { token: TemplateToken; replacement: string }[] = [];
  let position = 0;
  while (position < text.length) {
    const start = findNextTokenStart(text, position, delimiters);
    if (start === -1) {
      break;
    }
    const token = parseTemplateToken(text, start, delimiters);
    // Structural tags and unescaped fragments can alter the surrounding
    // grammar. Keep them on the legacy path rather than guessing their value.
    if (!token || token.kind !== 'mustache' || token.triple || token.ampersand) {
      return null;
    }
    const replacement = printTemplateToken(token);
    if (/["'\\`\r\n]/.test(replacement) || text[start - 1] === '\\') {
      return null;
    }
    tokens.push({ token, replacement });
    position = token.end;
  }

  // Check both the input and normalized replacements. Lowercase markers without
  // a leading underscore survive CSS normalization; a hyphen keeps dynamic JS keys
  // quoted even with quoteProps: 'as-needed'. Keep widths close to real tokens.
  const reserved = (text + tokens.map(({ replacement }) => replacement).join('')).toLowerCase();
  let salt = 0;
  while (reserved.includes(`m${salt}_`)) {
    salt += 1;
  }
  const restore = new Map<string, string>();
  const parts: string[] = [];
  position = 0;
  for (const [index, { token, replacement }] of tokens.entries()) {
    const prefix = `m${salt}_${index.toString(36)}-`;
    const placeholder = `${prefix}${'x'.repeat(Math.max(replacement.length - prefix.length - 1, 0))}z`;
    parts.push(text.slice(position, token.start), placeholder);
    restore.set(placeholder, replacement);
    position = token.end;
  }
  parts.push(text.slice(position));
  return { text: parts.join(''), restore };
}

function createDefaultDelimiters(): Delimiters {
  return { open: '{{', close: '}}' };
}

function cloneDelimiters(delimiters: Delimiters): Delimiters {
  return { open: delimiters.open, close: delimiters.close };
}

function hasUnclosedSection(source: string): boolean {
  const delimiters = createDefaultDelimiters();
  const stack: string[] = [];
  let position = 0;

  while (position < source.length) {
    const tokenStart = findNextTokenStart(source, position, delimiters);
    if (tokenStart === -1) {
      break;
    }

    const token = parseTemplateToken(source, tokenStart, delimiters);
    if (!token) {
      break;
    }

    if (token.kind === 'sectionStart' && token.name) {
      stack.push(token.name);
    } else if (token.kind === 'sectionEnd' && token.name) {
      const last = stack[stack.length - 1];
      if (last === token.name) {
        stack.pop();
      }
    } else if (token.kind === 'delimiter' && token.nextOpen && token.nextClose) {
      delimiters.open = token.nextOpen;
      delimiters.close = token.nextClose;
    }

    position = token.end > tokenStart ? token.end : tokenStart + token.open.length;
  }

  return stack.length > 0;
}

function normalizeMustacheInText(text: string, delimiters: Delimiters): { text: string; tokens: TemplateToken[] } {
  const tokens: TemplateToken[] = [];
  const parts: string[] = [];
  let position = 0;

  while (position < text.length) {
    const tokenStart = findNextTokenStart(text, position, delimiters);

    if (tokenStart === -1) {
      parts.push(text.slice(position));
      break;
    }

    const token = parseTemplateToken(text, tokenStart, delimiters);
    if (!token) {
      parts.push(text.slice(position));
      break;
    }

    parts.push(text.slice(position, tokenStart));
    parts.push(printTemplateToken(token));
    tokens.push(token);

    if (token.kind === 'delimiter' && token.nextOpen && token.nextClose) {
      delimiters.open = token.nextOpen;
      delimiters.close = token.nextClose;
    }

    position = token.end;
  }

  return { text: parts.join(''), tokens };
}

function parseStandaloneToken(trimmedLine: string, delimiters: Delimiters): TemplateToken | null {
  const token = parseTemplateToken(trimmedLine, 0, cloneDelimiters(delimiters));
  return token && token.end === trimmedLine.length ? token : null;
}

function findNextTokenStart(text: string, position: number, delimiters: Delimiters): number {
  const normal = text.indexOf(delimiters.open, position);

  if (delimiters.open === '{{') {
    const triple = text.indexOf('{{{', position);
    if (triple !== -1 && (normal === -1 || triple <= normal)) {
      return triple;
    }
  }

  return normal;
}

function parseTemplateToken(text: string, position: number, delimiters: Delimiters): TemplateToken | null {
  const triple = delimiters.open === '{{' && text.startsWith('{{{', position);
  const open = triple ? '{{{' : delimiters.open;
  const close = triple ? '}}}' : delimiters.close;

  if (!text.startsWith(open, position)) {
    return null;
  }

  const contentStart = position + open.length;
  const closeIdx = findTemplateClose(text, contentStart, close);
  if (closeIdx === -1) {
    return null;
  }

  const end = closeIdx + close.length;
  const rawContent = text.slice(contentStart, closeIdx);
  const content = rawContent.trim();
  const raw = text.slice(position, end);
  const base = { raw, content, start: position, end, open, close, triple, ampersand: false };

  if (!triple && content.startsWith('=') && content.endsWith('=')) {
    const delimiterContent = content.slice(1, -1).trim();
    const parts = delimiterContent.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return { ...base, kind: 'delimiter', nextOpen: parts[0], nextClose: parts[1] };
    }
  }

  if (!triple && content.startsWith('!')) {
    return { ...base, kind: 'comment', content: content.slice(1).trim() };
  }

  if (!triple && content.startsWith('>')) {
    return { ...base, kind: 'partial', content: content.slice(1).trim() };
  }

  if (!triple && content.startsWith('/')) {
    const name = readTemplateName(content.slice(1).trim());
    return { ...base, kind: 'sectionEnd', content: content.slice(1).trim(), name };
  }

  if (!triple && /^[#^<$]/.test(content)) {
    const prefix = content[0];
    const expression = content.slice(1).trim();
    return {
      ...base,
      kind: 'sectionStart',
      content: expression,
      sectionKind: getTemplateSectionKind(prefix),
      name: readTemplateName(expression),
    };
  }

  if (!triple && content.startsWith('&')) {
    return { ...base, kind: 'mustache', content: content.slice(1).trim(), ampersand: true };
  }

  return { ...base, kind: 'mustache' };
}

function findTemplateClose(text: string, position: number, close: string): number {
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = position; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if ((char === '"' || char === "'" || char === '`') && isTemplateExpressionQuoteStart(text, index, position)) {
      quote = char;
      continue;
    }

    if (text.startsWith(close, index)) {
      return index;
    }
  }

  return -1;
}

function getTemplateSectionKind(prefix: string): 'section' | 'inverted' | 'parent' | 'block' {
  if (prefix === '^') return 'inverted';
  if (prefix === '<') return 'parent';
  if (prefix === '$') return 'block';
  return 'section';
}

function readTemplateName(expression: string): string {
  return expression.trim().split(/\s+/)[0] ?? '';
}

function printTemplateToken(token: TemplateToken): string {
  switch (token.kind) {
    case 'delimiter':
      return `${token.open}= ${token.nextOpen ?? '{{'} ${token.nextClose ?? '}}'} =${token.close}`;
    case 'comment':
      return token.content.length > 0 ? `${token.open}! ${normalizeCommentValue(token.content)} ${token.close}` : `${token.open}!${token.close}`;
    case 'partial':
      return `${token.open}> ${normalizeTemplateExpression(token.content)} ${token.close}`;
    case 'sectionEnd':
      return `${token.open}/${token.name ?? normalizeTemplateExpression(token.content)}${token.close}`;
    case 'sectionStart':
      return printTemplateSectionOpen(token);
    case 'mustache': {
      const expression = normalizeTemplateExpression(token.content);

      if (token.triple) {
        return `${token.open} ${expression} ${token.close}`;
      }

      if (token.ampersand) {
        return `${token.open}& ${expression} ${token.close}`;
      }

      return `${token.open} ${expression} ${token.close}`;
    }
  }
}

function printTemplateSectionOpen(token: TemplateToken): string {
  const expression = normalizeTemplateExpression(token.content);

  switch (token.sectionKind) {
    case 'inverted':
      return `${token.open}^${expression}${token.close}`;
    case 'parent':
      return `${token.open}< ${expression}${token.close}`;
    case 'block':
      return `${token.open}$${expression}${token.close}`;
    case 'section':
    default:
      return `${token.open}#${expression}${token.close}`;
  }
}

function normalizeTemplateExpression(content: string): string {
  const parsed = parseTemplateExpression(content);
  const parts = [parsed.path, ...parsed.params, ...parsed.hash.map((pair) => `${pair.key}=${pair.value}`)].filter(Boolean);
  return parts.join(' ');
}

function isAttributeValueCloseLine(line: string, quote: '"' | "'"): boolean {
  return line === quote;
}

function startsMultilineAttributeValue(line: string): boolean {
  const quote = getMultilineAttributeQuote(line);
  return quote !== null;
}

function getMultilineAttributeQuote(line: string): '"' | "'" | null {
  const match = line.match(/=\s*(["'])/);
  if (!match) {
    return null;
  }

  const quote = match[1] as '"' | "'";
  const quoteIndex = line.indexOf(quote, match.index);
  const rest = line.slice(quoteIndex + 1);
  return rest.includes(quote) ? null : quote;
}

function closesPendingOpenTag(line: string): boolean {
  return findUnquotedGreaterThan(line) !== -1;
}

function isOnlyTagCloseLine(line: string): boolean {
  return line === '>' || line === '/>';
}

function closesPendingElementOnSameLine(line: string, tag: string): boolean {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^>\\s*</\\s*${escapedTag}\\s*>$`, 'i').test(line);
}

function isSelfClosingTagLine(line: string): boolean {
  return /\/\s*>$/.test(line);
}

function getMultilineOpenTag(line: string): string | null {
  if (!line.startsWith('<') || line.startsWith('</') || line.startsWith('<!--') || line.startsWith('<!')) {
    return null;
  }

  const tag = readHtmlTagName(line, 1);
  if (!tag) {
    return null;
  }

  return findUnquotedGreaterThan(line) === -1 ? tag : null;
}

function countLeadingHtmlCloseTags(line: string): number {
  let count = 0;
  let rest = line;

  while (true) {
    const match = rest.match(/^<\/[A-Za-z][\w:-]*\s*>/);
    if (!match) {
      break;
    }

    count += 1;
    rest = rest.slice(match[0].length).trimStart();
  }

  return count;
}

function getHtmlDepthDelta(line: string, consumedLeadingCloseTags: number): number {
  let delta = 0;
  let consumedCloseTags = consumedLeadingCloseTags;
  let position = 0;

  while (position < line.length) {
    const start = line.indexOf('<', position);
    if (start === -1) {
      break;
    }

    if (line.startsWith('<!--', start)) {
      const end = line.indexOf('-->', start + 4);
      position = end === -1 ? line.length : end + 3;
      continue;
    }

    if (line.startsWith('<!', start)) {
      const end = line.indexOf('>', start + 2);
      position = end === -1 ? line.length : end + 1;
      continue;
    }

    if (line.startsWith('</', start)) {
      const end = findUnquotedGreaterThan(line, start + 2);
      if (end === -1) {
        break;
      }

      if (consumedCloseTags > 0) {
        consumedCloseTags -= 1;
      } else {
        delta -= 1;
      }

      position = end + 1;
      continue;
    }

    const tag = readHtmlTagName(line, start + 1);
    if (!tag) {
      position = start + 1;
      continue;
    }

    const end = findUnquotedGreaterThan(line, start + 1);
    if (end === -1) {
      break;
    }

    const rawTag = line.slice(start, end + 1);
    if (!/\/\s*>$/.test(rawTag) && !voidElements.has(tag.toLowerCase())) {
      delta += 1;
    }

    position = end + 1;
  }

  return delta;
}

function readHtmlTagName(text: string, position: number): string {
  let index = position;
  while (index < text.length && /[A-Za-z0-9_:-]/.test(text[index])) {
    index += 1;
  }

  return text.slice(position, index);
}

function findUnquotedGreaterThan(text: string, position = 0): number {
  let quote: '"' | "'" | null = null;

  for (let index = position; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function formatProgram(program: Program, context: PrintContext): string {
  const output = formatNodes(program.body, context).trimEnd();
  return output.length > 0 ? `${output}\n` : '';
}

function formatNodes(nodes: Node[], context: PrintContext): string {
  return nodes.map((node) => printNode(node, context)).join('');
}

function printNode(node: Node, context: PrintContext): string {
  switch (node.type) {
    case 'Program':
      return formatProgram(node, context);
    case 'TextNode':
      return node.value;
    case 'MustacheStatement':
      return printMustache(node);
    case 'PartialStatement':
      return printPartial(node);
    case 'CommentStatement':
      return printComment(node);
    case 'DelimiterStatement':
      return printDelimiter(node);
    case 'SectionStatement':
      return printSection(node, context);
    case 'UnmatchedNode':
      return node.raw;
  }
}

function printMustache(node: MustacheStatement): string {
  const expression = buildExpression(node);

  if (node.triple) {
    return `${node.open} ${expression} ${node.close}`;
  }

  if (node.ampersand) {
    return `${node.open}& ${expression} ${node.close}`;
  }

  return `${node.open} ${expression} ${node.close}`;
}

function printPartial(node: PartialStatement): string {
  return `${node.open}> ${buildExpression(node)} ${node.close}`;
}

function printComment(node: CommentStatement): string {
  const value = normalizeCommentValue(node.value);
  return value.length > 0 ? `${node.open}! ${value} ${node.close}` : `${node.open}!${node.close}`;
}

function normalizeCommentValue(value: string): string {
  const lines = value.trim().split('\n');

  return lines
    .map((line, index) => (index === 0 ? line.trim() : line.trimStart().replace(/[ \t]+$/g, '')))
    .join('\n');
}

function printDelimiter(node: DelimiterStatement): string {
  return `${node.open}= ${node.nextOpen} ${node.nextClose} =${node.close}`;
}

function printSection(node: SectionStatement, context: PrintContext): string {
  const openTag = printSectionOpen(node);
  const closeTag = `${node.closeOpen}/${node.path}${node.closeClose}`;
  const rawBody = formatSectionBodyNodes(node.body, context);

  if (node.inline && !rawBody.includes('\n')) {
    return `${openTag}${rawBody}${closeTag}`;
  }

  const body = rawBody.trim();

  if (body.length === 0) {
    return `${openTag}\n${closeTag}`;
  }

  return `${openTag}\n${indent(body, context)}\n${closeTag}`;
}

function formatSectionBodyNodes(nodes: Node[], context: PrintContext): string {
  return nodes
    .map((node) => {
      if (node.type === 'TextNode' && node.value.includes('\n')) {
        const normalized = node.value.replace(/\n[ \t]+/g, '\n');
        return /^\s*$/.test(normalized) ? normalized.replace(/[^\n]+/g, '') : normalized;
      }

      return printNode(node, context);
    })
    .join('');
}

function printSectionOpen(node: SectionStatement): string {
  const expression = buildExpression(node);

  switch (node.kind) {
    case 'inverted':
      return `${node.open}^${expression}${node.close}`;
    case 'parent':
      return `${node.open}< ${expression}${node.close}`;
    case 'block':
      return `${node.open}$${expression}${node.close}`;
    case 'section':
      return `${node.open}#${expression}${node.close}`;
  }
}

function buildExpression(node: Pick<MustacheStatement | PartialStatement | SectionStatement, 'path' | 'params' | 'hash'>): string {
  const parts = [node.path, ...node.params, ...node.hash.map((pair) => `${pair.key}=${pair.value}`)].filter(Boolean);
  return parts.join(' ');
}

function indent(value: string, context: PrintContext): string {
  return value
    .split('\n')
    .map((line) => (line.length > 0 ? `${context.indentation}${line}` : line))
    .join('\n');
}
