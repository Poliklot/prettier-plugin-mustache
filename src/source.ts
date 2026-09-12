import { isTemplateExpressionQuoteStart, parseTemplateExpression, voidElements, withRange } from 'template-format-core';
import { discoverProtectedRegions } from './raw-regions';
import type { SourceLine, SourceSegment } from './types';

interface Delimiters {
  open: string;
  close: string;
}

type RawTextTag = 'script' | 'style';

export type EmbeddedLanguage =
  | { parser: 'babel'; sourceType: 'script' | 'module' }
  | { parser: 'css' };

// Script types whose body is still plain JavaScript. Anything else (JSON
// islands, other templating languages sharing the file, etc.) is left to the
// source-preserving fallback rather than risking a confidently wrong
// reformat.
const JS_SCRIPT_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/babel', 'application/ecmascript']);

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

export function discoverSource(source: string): SourceSegment[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (normalized.trim().length === 0) {
    return [];
  }

  const scanned = scanTemplateTokens(normalized, createDefaultDelimiters());
  if (!scanned.complete || hasUnclosedSection(scanned.tokens)) {
    return [withRange({ type: 'VerbatimSource', text: normalized }, 0, normalized.length)];
  }

  const withoutFinalNewline = normalized.replace(/\n+$/g, '');
  const lines = withoutFinalNewline.split('\n');
  const protectedRegions = discoverProtectedRegions(normalized, scanned.tokens);

  if (lines.length === 1 && !protectedRegions.length) {
    const delimiters = createDefaultDelimiters();
    const formatted = normalizeMustacheInText(lines[0].replace(/[ \t]+$/g, ''), delimiters).text.trimEnd();
    return formatted.length > 0 ? [withRange({ type: 'SourceLine', text: formatted, depth: 0, leadingLine: false }, 0, lines[0].length)] : [];
  }

  const state = {
    depth: 0,
    delimiters: createDefaultDelimiters(),
    pendingOpenTag: undefined as PendingOpenTag | undefined,
    pendingAttributeValue: undefined as PendingAttributeValue | undefined,
  };
  const output: SourceSegment[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const lineNode = (text: string, depth: number, index: number, leadingLine = true): SourceLine =>
    withRange({ type: 'SourceLine', text, depth, leadingLine }, offsets[index], offsets[index] + lines[index].length);
  const pushLine = (text: string, depth: number, index: number) =>
    output.push(lineNode(text, depth, index, output.length > 0));

  function lineAt(position: number): number {
    let low = 0;
    let high = offsets.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle] <= position) low = middle;
      else high = middle;
    }
    return low;
  }
  let regionIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const rawTrimmed = rawLine.trim();

    const region = protectedRegions[regionIndex];
    if (region && lineAt(region.start) === lineIndex) {
      let last = region;
      const regions = [region];
      regionIndex += 1;
      // Several protected elements sharing a physical line are one opaque
      // source region; do not invent whitespace between inline elements.
      while (protectedRegions[regionIndex] && lineAt(protectedRegions[regionIndex].start) <= lineAt(last.end - 1)) {
        last = protectedRegions[regionIndex++];
        regions.push(last);
      }
      const lastLine = lineAt(last.end - 1);
      const endOfLine = offsets[lastLine] + lines[lastLine].length;
      const standalone = regions.length === 1 && region.embeddable &&
        !normalized.slice(offsets[lineIndex], region.start).trim() &&
        !normalized.slice(region.openEnd, offsets[lineAt(region.openEnd!)] + lines[lineAt(region.openEnd!)].length).trim() &&
        lineAt(region.closeStart!) > lineAt(region.openEnd!) &&
        !normalized.slice(offsets[lineAt(region.closeStart!)], region.closeStart).trim() &&
        !normalized.slice(region.end, endOfLine).trim();
      if (standalone) {
        const opening = normalized.slice(region.start, region.openEnd);
        // Attribute delimiter changes affect the body, body changes affect
        // following HTML. Never normalize opaque text to advance this state.
        scanTemplateTokens(opening, state.delimiters);
        const delimiters = cloneDelimiters(state.delimiters);
        const text = normalized.slice(region.openEnd, region.closeStart);
        scanTemplateTokens(text, state.delimiters);
        output.push(withRange({
          type: 'RawTextElement', opening, closing: normalized.slice(region.closeStart, region.end),
          depth: state.depth, leadingLine: output.length > 0,
          body: withRange({ type: 'RawTextBody', tag: region.tag as RawTextTag,
            attrsText: region.attrsText!, text, depth: state.depth + 1, delimiters }, region.openEnd!, region.closeStart!),
        }, region.start, region.end));
      } else {
        const terminal = Boolean(last.terminal);
        const end = terminal ? normalized.length : endOfLine;
        const text = normalized.slice(offsets[lineIndex], end);
        scanTemplateTokens(text, state.delimiters);
        // Only the surrounding HTML contributes to structural depth. Tags in
        // a string, comment, textarea, pre or foreign fragment are not children.
        let previous = offsets[lineIndex];
        const exterior = regions.map((item) => {
          const part = normalized.slice(previous, item.start);
          previous = item.end;
          return part;
        }).join('') + normalized.slice(previous, end);
        // The whitespace before a standalone protected opening is outside its
        // content. Keep normal outer indentation there, not inside raw text.
        const canIndent = !normalized.slice(offsets[lineIndex], region.start).trim() ||
          (!terminal && lineIndex === lastLine);
        const depth = canIndent ? Math.max(0, state.depth - countLeadingHtmlCloseTags(exterior.trimStart())) : undefined;
        output.push(withRange({ type: 'OpaqueSource', text, leadingLine: output.length > 0, terminal, depth }, offsets[lineIndex], end));
        state.depth = Math.max(0, state.depth + getHtmlDepthDelta(exterior, 0));
      }
      lineIndex = lastLine;
      continue;
    }

    if (rawTrimmed.length === 0) {
      pushLine('', 0, lineIndex);
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

      pushLine(normalizedLine, indentDepth, lineIndex);

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

      pushLine(normalizedLine, indentDepth, lineIndex);

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
    pushLine(normalizedLine, indentDepth, lineIndex);

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

    const htmlDepthDelta = getHtmlDepthDelta(normalizedLine, leadingCloseCount);
    state.depth = Math.max(0, state.depth + htmlDepthDelta);
  }

  while (output[output.length - 1]?.type === 'SourceLine' && !(output[output.length - 1] as SourceLine).text) {
    output.pop();
  }
  return output;
}

function normalizeAttributeValue(value: string): string {
  // HTML trims only these five ASCII characters, not all String#trim whitespace.
  // Scan each edge once: an unanchored whitespace+$ regexp retries at every
  // interior whitespace position and can take quadratic time on library input.
  const whitespace = '\t\n\f\r ';
  let start = 0;
  let end = value.length;
  while (start < end && whitespace.includes(value[start])) start += 1;
  while (end > start && whitespace.includes(value[end - 1])) end -= 1;
  return value.slice(start, end).toLowerCase();
}

export function resolveEmbeddedLanguage(tag: RawTextTag, attrsText: string): EmbeddedLanguage | null {
  const attributes = parseRawTextAttributes(attrsText);
  if (!attributes) {
    return null;
  }

  const rawType = attributes.get('type');
  const language = attributes.get('language') ?? '';
  const type = rawType === undefined && tag === 'script' && language !== ''
    ? `text/${language.toLowerCase()}` : normalizeAttributeValue(rawType ?? '');
  const lang = normalizeAttributeValue(attributes.get('lang') ?? '');
  // Empty type defaults to JS, but a nonempty whitespace-only type does not.
  // A legacy language attribute only applies when type is absent.
  // https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
  if (rawType !== undefined && rawType !== '' && type === '') return null;
  if (tag === 'style') {
    return (!type || type === 'text/css') && (!lang || lang === 'css') ? { parser: 'css' } : null;
  }
  if (attributes.has('src') || (lang && !['js', 'javascript'].includes(lang))) {
    return null;
  }
  if (!JS_SCRIPT_TYPES.has(type)) return null;
  return { parser: 'babel', sourceType: type === 'module' ||
    (type === 'text/babel' && attributes.get('data-type') === 'module') ? 'module' : 'script' };
}

function parseRawTextAttributes(text: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let position = 0;
  while (position < text.length) {
    const whitespace = text.slice(position).match(/^[\t\n\f\r ]+/);
    if (!whitespace) {
      return null;
    }
    position += whitespace[0].length;
    if (position === text.length) {
      break;
    }

    const nameMatch = text.slice(position).match(/^[^\t\n\f\r =/<>"'`]+/);
    if (!nameMatch) {
      return null;
    }
    const name = nameMatch[0].toLowerCase();
    position += nameMatch[0].length;
    const afterName = position;
    position += text.slice(position).match(/^[\t\n\f\r ]*/)?.[0].length ?? 0;

    let value = '';
    if (text[position] === '=') {
      position += 1;
      position += text.slice(position).match(/^[\t\n\f\r ]*/)?.[0].length ?? 0;
      const quote = text[position];
      if (quote === '"' || quote === "'") {
        const end = text.indexOf(quote, position + 1);
        if (end === -1) {
          return null;
        }
        value = text.slice(position + 1, end);
        position = end + 1;
      } else {
        const valueMatch = text.slice(position).match(/^[^\t\n\f\r <>"'`=]+/);
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

export function extractMustachePlaceholders(
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
    // grammar. Keep their original source rather than guessing their value.
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

function hasUnclosedSection(tokens: TemplateToken[]): boolean {
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'sectionStart' && token.name) {
      stack.push(token.name);
    } else if (token.kind === 'sectionEnd' && token.name) {
      const last = stack[stack.length - 1];
      if (last === token.name) {
        stack.pop();
      }
    }
  }

  return stack.length > 0;
}

function scanTemplateTokens(text: string, delimiters: Delimiters): { tokens: TemplateToken[]; complete: boolean } {
  const tokens: TemplateToken[] = [];
  let position = 0;
  while (position < text.length) {
    const tokenStart = findNextTokenStart(text, position, delimiters);
    if (tokenStart === -1) break;
    const token = parseTemplateToken(text, tokenStart, delimiters);
    if (!token) return { tokens, complete: false };
    tokens.push(token);
    if (token.kind === 'delimiter' && token.nextOpen && token.nextClose) {
      delimiters.open = token.nextOpen;
      delimiters.close = token.nextClose;
    }
    position = token.end;
  }
  return { tokens, complete: true };
}

function normalizeMustacheInText(text: string, delimiters: Delimiters): { text: string; tokens: TemplateToken[] } {
  const { tokens } = scanTemplateTokens(text, delimiters);
  const parts: string[] = [];
  let position = 0;
  for (const token of tokens) {
    parts.push(text.slice(position, token.start), printTemplateToken(token));
    position = token.end;
  }
  parts.push(text.slice(position));
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

function normalizeCommentValue(value: string): string {
  const lines = value.trim().split('\n');

  return lines
    .map((line, index) => (index === 0 ? line.trim() : line.trimStart().replace(/[ \t]+$/g, '')))
    .join('\n');
}
