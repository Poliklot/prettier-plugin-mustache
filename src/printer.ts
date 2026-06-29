import type { AstPath, Doc, ParserOptions, Printer } from 'prettier';
import { isTemplateExpressionQuoteStart, parseTemplateExpression, voidElements } from 'template-format-core';
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
  print(path: AstPath<Node>, options: ParserOptions<Node>): Doc {
    const node = path.getValue();

    if (!node) {
      return '';
    }

    const context = createPrintContext(options);

    if (node.type === 'Program') {
      if (typeof node.source === 'string') {
        return formatSource(node.source, options);
      }

      return formatProgram(node, context);
    }

    return printNode(node, context);
  },
  getVisitorKeys() {
    return [];
  },
};

function createPrintContext(options: ParserOptions<Node>): PrintContext {
  return {
    indentation: options.useTabs ? '\t' : ' '.repeat(options.tabWidth ?? 2),
  };
}

function formatSource(source: string, options: ParserOptions<Node>): string {
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

  const state = {
    depth: 0,
    delimiters: createDefaultDelimiters(),
    pendingOpenTag: undefined as PendingOpenTag | undefined,
    pendingAttributeValue: undefined as PendingAttributeValue | undefined,
  };
  const output: string[] = [];

  for (const rawLine of lines) {
    const rawTrimmed = rawLine.trim();

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

    const htmlDepthDelta = getHtmlDepthDelta(normalizedLine, leadingCloseCount);
    state.depth = Math.max(0, state.depth + htmlDepthDelta);
  }

  return `${output.join('\n').trimEnd()}\n`;
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
