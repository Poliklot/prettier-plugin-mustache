import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from '../dist/parser.js';

test('parses Mustache sections and children', () => {
  const ast = parse('{{#items}}{{name}}{{/items}}');
  assert.equal(ast.type, 'Program');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].kind, 'section');
  assert.equal(ast.body[0].path, 'items');
  assert.equal(ast.body[0].inline, true);
  assert.equal(ast.body[0].body[0].type, 'MustacheStatement');
  assert.equal(ast.body[0].body[0].path, 'name');
});

test('marks multiline sections separately from inline sections', () => {
  const ast = parse('{{#items}}\n{{name}}\n{{/items}}');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].inline, false);
});

test('parses Mustache parents, blocks, dynamic names, and delimiter changes', () => {
  const ast = parse('{{<*dynamic}}{{$title}}Hi{{/title}}{{/*dynamic}}{{=<% %>=}}<%name%>');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].kind, 'parent');
  assert.equal(ast.body[0].path, '*dynamic');
  assert.equal(ast.body[0].body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].body[0].kind, 'block');
  assert.equal(ast.body[1].type, 'DelimiterStatement');
  assert.equal(ast.body[2].type, 'MustacheStatement');
  assert.equal(ast.body[2].open, '<%');
  assert.equal(ast.body[2].close, '%>');
});


test('parses section names with Mustache punctuation', () => {
  const ast = parse('{{#person?}}Hi {{name}}{{/person?}}');
  assert.equal(ast.body[0].type, 'SectionStatement');
  assert.equal(ast.body[0].path, 'person?');
});
