import prettier from 'prettier';
import * as plugin from '../dist/plugin.js';

const seed = Number.parseInt(process.env.MUSTACHE_FUZZ_SEED ?? '20260604', 10);
const caseCount = Number.parseInt(process.env.MUSTACHE_FUZZ_CASES ?? '431', 10);

function createRandom(initialSeed) {
  let state = initialSeed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = createRandom(seed);

function pick(items) {
  return items[Math.floor(random() * items.length)];
}

const names = ['name', 'user.name', '.', 'items', 'person?', 'status-code', 'meta.title', 'links.self'];
const text = ['Hello', '<li>', '</li>', ' ', '\n', ' — ', 'value=', 'markdown **bold**'];

function expression() {
  const base = pick(names);
  const maybeParam = random() > 0.78 ? ` ${pick(names)}` : '';
  const maybeHash = random() > 0.82 ? ` label=${pick(['"Name"', 'title', 'meta.title'])}` : '';
  return `${base}${maybeParam}${maybeHash}`;
}

function variable() {
  const expr = expression();
  const kind = pick(['escaped', 'triple', 'amp']);

  if (kind === 'triple') {
    return `{{{${expr}}}}`;
  }

  if (kind === 'amp') {
    return `{{& ${expr}}}`;
  }

  return `{{${expr}}}`;
}

function partial() {
  return random() > 0.75 ? `{{>*${pick(['partial', 'layout', 'row'])}}}` : `{{> ${pick(['user', 'row', 'empty_state'])}}}`;
}

function comment() {
  return random() > 0.8 ? '{{! first\nsecond }}' : `{{! ${pick(['comment', 'empty', 'generated'])}}}`;
}

function delimiterCase() {
  return '{{=<% %>=}}Hello <%name%> <%={{ }}=%> {{again}}';
}

function section(depth = 0) {
  const name = pick(['items', 'person?', 'rows', 'enabled']);
  const prefix = pick(['#', '^']);
  const body = Array.from({ length: 1 + Math.floor(random() * 4) }, () => node(depth + 1)).join('');
  return `{{${prefix}${name}}}${body}{{/${name}}}`;
}

function parent(depth = 0) {
  const title = `{{$title}}${node(depth + 1)}{{/title}}`;
  const body = random() > 0.5 ? `${title}{{$body}}${node(depth + 1)}{{/body}}` : title;
  return `{{< layout}}${body}{{/layout}}`;
}

function node(depth = 0) {
  const choices = depth > 2 ? ['text', 'variable', 'partial', 'comment'] : ['text', 'variable', 'partial', 'comment', 'section', 'parent', 'delimiter'];
  const choice = pick(choices);

  switch (choice) {
    case 'variable':
      return variable();
    case 'partial':
      return partial();
    case 'comment':
      return comment();
    case 'section':
      return section(depth);
    case 'parent':
      return parent(depth);
    case 'delimiter':
      return delimiterCase();
    case 'text':
    default:
      return pick(text);
  }
}

function template() {
  return Array.from({ length: 3 + Math.floor(random() * 8) }, () => node()).join('');
}

for (let index = 0; index < caseCount; index += 1) {
  const source = template();
  const formatted = await prettier.format(source, {
    parser: 'mustache',
    plugins: [plugin],
  });
  const second = await prettier.format(formatted, {
    parser: 'mustache',
    plugins: [plugin],
  });

  if (second !== formatted) {
    console.error(`Fuzz case ${index} is not idempotent:`);
    console.error(source);
    console.error('--- formatted ---');
    console.error(formatted);
    console.error('--- second ---');
    console.error(second);
    process.exit(1);
  }
}

console.log(`Mustache fuzz check passed: ${caseCount} cases, seed=${seed}.`);
