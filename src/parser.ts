import {
  locEnd,
  locStart,
  normalizeInput,
  parseTemplateExpression,
  withRange,
} from 'template-format-core';
import type {
  CommentStatement,
  DelimiterStatement,
  MustacheStatement,
  Node,
  PartialStatement,
  Program,
  SectionKind,
  SectionStatement,
  TextNode,
  UnmatchedNode,
} from './types';

export { locEnd, locStart };

interface Delimiters {
  open: string;
  close: string;
}

interface Token {
  kind: 'mustache' | 'partial' | 'comment' | 'sectionStart' | 'sectionEnd' | 'delimiter';
  raw: string;
  content: string;
  start: number;
  end: number;
  open: string;
  close: string;
  triple: boolean;
  ampersand: boolean;
  sectionKind?: SectionKind;
  name?: string;
  nextOpen?: string;
  nextClose?: string;
}

interface ParseResult {
  nodes: Node[];
  position: number;
  closed: boolean;
  closeToken?: Token;
}

export function parse(text: string): Program {
  const normalized = normalizeInput(text);
  const delimiters: Delimiters = { open: '{{', close: '}}' };
  const result = parseNodes(normalized, 0, delimiters, null);
  return withRange({ type: 'Program', body: result.nodes }, 0, normalized.length);
}

function parseNodes(text: string, position: number, delimiters: Delimiters, endName: string | null): ParseResult {
  const nodes: Node[] = [];
  let pos = position;

  while (pos < text.length) {
    const tokenStart = findNextTokenStart(text, pos, delimiters);

    if (tokenStart === -1) {
      pushText(nodes, text, pos, text.length);
      return { nodes, position: text.length, closed: false };
    }

    pushText(nodes, text, pos, tokenStart);

    const token = parseToken(text, tokenStart, delimiters);

    if (token.kind === 'delimiter') {
      nodes.push(createDelimiter(token));
      delimiters.open = token.nextOpen ?? delimiters.open;
      delimiters.close = token.nextClose ?? delimiters.close;
      pos = token.end;
      continue;
    }

    if (token.kind === 'sectionEnd') {
      if (endName && token.name === endName) {
        return { nodes, position: token.end, closed: true, closeToken: token };
      }

      nodes.push(createUnmatched(token));
      pos = token.end;
      continue;
    }

    if (token.kind === 'sectionStart') {
      const childResult = parseNodes(text, token.end, delimiters, token.name ?? '');

      if (!childResult.closed) {
        nodes.push(withRange({ type: 'UnmatchedNode', raw: text.slice(token.start, childResult.position) }, token.start, childResult.position));
        pos = childResult.position;
        continue;
      }

      const rawBody = text.slice(token.end, childResult.closeToken?.start ?? childResult.position);
      nodes.push(createSection(token, childResult.nodes, childResult.closeToken, !rawBody.includes('\n')));
      pos = childResult.position;
      continue;
    }

    if (token.kind === 'partial') {
      nodes.push(createPartial(token));
      pos = token.end;
      continue;
    }

    if (token.kind === 'comment') {
      nodes.push(createComment(token));
      pos = token.end;
      continue;
    }

    nodes.push(createMustache(token));
    pos = token.end;
  }

  return { nodes, position: pos, closed: false };
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

function parseToken(text: string, position: number, delimiters: Delimiters): Token {
  const triple = delimiters.open === '{{' && text.startsWith('{{{', position);
  const open = triple ? '{{{' : delimiters.open;
  const close = triple ? '}}}' : delimiters.close;
  const contentStart = position + open.length;
  const closeIdx = text.indexOf(close, contentStart);
  const end = closeIdx === -1 ? text.length : closeIdx + close.length;
  const rawContent = text.slice(contentStart, closeIdx === -1 ? undefined : closeIdx);
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
    return { ...base, kind: 'sectionEnd', content: content.slice(1).trim(), name: readName(content.slice(1).trim()) };
  }

  if (!triple && /^[#^<$]/.test(content)) {
    const prefix = content[0];
    const expression = content.slice(1).trim();
    return {
      ...base,
      kind: 'sectionStart',
      content: expression,
      sectionKind: getSectionKind(prefix),
      name: readName(expression),
    };
  }

  if (!triple && content.startsWith('&')) {
    return { ...base, kind: 'mustache', content: content.slice(1).trim(), ampersand: true };
  }

  return { ...base, kind: 'mustache' };
}

function getSectionKind(prefix: string): SectionKind {
  if (prefix === '^') return 'inverted';
  if (prefix === '<') return 'parent';
  if (prefix === '$') return 'block';
  return 'section';
}

function readName(expression: string): string {
  return expression.trim().split(/\s+/)[0] ?? '';
}

function pushText(nodes: Node[], text: string, start: number, end: number): void {
  if (end <= start) {
    return;
  }

  nodes.push(withRange({ type: 'TextNode', value: text.slice(start, end) } as TextNode, start, end));
}

function createExpression(content: string): { path: string; params: string[]; hash: Array<{ key: string; value: string }> } {
  const parsed = parseTemplateExpression(content);
  return {
    path: parsed.path,
    params: parsed.params,
    hash: parsed.hash,
  };
}

function createMustache(token: Token): MustacheStatement {
  return withRange(
    {
      type: 'MustacheStatement',
      ...createExpression(token.content),
      triple: token.triple,
      ampersand: token.ampersand,
      open: token.open,
      close: token.close,
    },
    token.start,
    token.end,
  );
}

function createPartial(token: Token): PartialStatement {
  return withRange(
    {
      type: 'PartialStatement',
      ...createExpression(token.content),
      open: token.open,
      close: token.close,
    },
    token.start,
    token.end,
  );
}

function createComment(token: Token): CommentStatement {
  return withRange({ type: 'CommentStatement', value: token.content, open: token.open, close: token.close }, token.start, token.end);
}

function createDelimiter(token: Token): DelimiterStatement {
  return withRange(
    {
      type: 'DelimiterStatement',
      open: token.open,
      close: token.close,
      nextOpen: token.nextOpen ?? '{{',
      nextClose: token.nextClose ?? '}}',
    },
    token.start,
    token.end,
  );
}

function createSection(token: Token, body: Node[], closeToken: Token | undefined, inline: boolean): SectionStatement {
  return withRange(
    {
      type: 'SectionStatement',
      kind: token.sectionKind ?? 'section',
      ...createExpression(token.content),
      body,
      inline,
      open: token.open,
      close: token.close,
      closeOpen: closeToken?.open ?? token.open,
      closeClose: closeToken?.close ?? token.close,
      closed: Boolean(closeToken),
    },
    token.start,
    closeToken?.end ?? token.end,
  );
}

function createUnmatched(token: Token): UnmatchedNode {
  return withRange({ type: 'UnmatchedNode', raw: token.raw }, token.start, token.end);
}
