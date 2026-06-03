import type { AstPath, Doc, ParserOptions, Printer } from 'prettier';
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

export const printer: Printer<Node> = {
  print(path: AstPath<Node>, options: ParserOptions<Node>): Doc {
    const node = path.getValue();

    if (!node) {
      return '';
    }

    const context = createPrintContext(options);

    if (node.type === 'Program') {
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
  const value = node.value.trim();
  return value.length > 0 ? `${node.open}! ${value} ${node.close}` : `${node.open}!${node.close}`;
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
      if (node.type === 'TextNode' && /^\s*$/.test(node.value) && node.value.includes('\n')) {
        return node.value.replace(/[^\n]+/g, '');
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
