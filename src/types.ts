import type { SourceRange } from 'template-format-core';

export type Node =
  | Program
  | TextNode
  | MustacheStatement
  | PartialStatement
  | CommentStatement
  | SectionStatement
  | DelimiterStatement
  | UnmatchedNode;

export interface Program extends SourceRange {
  type: 'Program';
  body: Node[];
}

export interface TextNode extends SourceRange {
  type: 'TextNode';
  value: string;
}

export interface MustacheStatement extends SourceRange {
  type: 'MustacheStatement';
  path: string;
  params: string[];
  hash: Array<{ key: string; value: string }>;
  triple: boolean;
  ampersand: boolean;
  open: string;
  close: string;
}

export interface PartialStatement extends SourceRange {
  type: 'PartialStatement';
  path: string;
  params: string[];
  hash: Array<{ key: string; value: string }>;
  open: string;
  close: string;
}

export interface CommentStatement extends SourceRange {
  type: 'CommentStatement';
  value: string;
  open: string;
  close: string;
}

export interface DelimiterStatement extends SourceRange {
  type: 'DelimiterStatement';
  open: string;
  close: string;
  nextOpen: string;
  nextClose: string;
}

export type SectionKind = 'section' | 'inverted' | 'parent' | 'block';

export interface SectionStatement extends SourceRange {
  type: 'SectionStatement';
  kind: SectionKind;
  path: string;
  params: string[];
  hash: Array<{ key: string; value: string }>;
  body: Node[];
  inline: boolean;
  open: string;
  close: string;
  closeOpen: string;
  closeClose: string;
  closed: boolean;
}

export interface UnmatchedNode extends SourceRange {
  type: 'UnmatchedNode';
  raw: string;
}
