import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../dist/parser.js';

test('parses Mustache sections and children', () => {
  const ast = parse('{{#items}}{{name}}{{/items}}');
  assert.equal(ast.type, 'Program');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].kind, 'section');
  assert.equal(ast.body[0].path, 'items');
  assert.equal(ast.body[0].body[0].type, 'MustacheStatement');
  assert.equal(ast.body[0].body[0].path, 'name');
});

test('parses Mustache parents, blocks, and delimiter changes', () => {
  const ast = parse('{{< layout}}{{$title}}Hi{{/title}}{{/layout}}{{=<% %>=}}<%name%>');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].kind, 'parent');
  assert.equal(ast.body[0].body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].body[0].kind, 'block');
  assert.equal(ast.body[1].type, 'DelimiterStatement');
  assert.equal(ast.body[2].type, 'MustacheStatement');
  assert.equal(ast.body[2].open, '<%');
  assert.equal(ast.body[2].close, '%>');
});
