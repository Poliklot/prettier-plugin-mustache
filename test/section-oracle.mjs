// Compatibility delta for the historical HTML-layout assertions: a positive
// section can be callable, so its entire body is now source, not formatter input.
// This test-only scanner handles the two fixed delimiter pairs in these fixtures;
// runtime/lambda regressions independently prove the actual semantic invariant.
function sections(source) {
  const stack = [];
  const result = [];
  for (const match of source.matchAll(/\{\{\s*([#^<$\/])\s*([^{}]*?)\s*\}\}|<%\s*([#^<$\/])\s*([^%]*?)\s*%>/g)) {
    const kind = match[1] ?? match[3];
    const name = match[2] ?? match[4];
    if (kind !== '/') stack.push({ kind, name, start: match.index });
    else if (stack.at(-1)?.name === name) {
      const opening = stack.pop();
      if (opening.kind === '#') result.push({ ...opening, end: match.index + match[0].length });
    }
  }
  return result.sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((item, index, all) => !all.slice(0, index).some(outer => item.start >= outer.start && item.end <= outer.end));
}

export function preserveCallableSections(source, historicalExpected) {
  const originals = sections(source);
  const formatted = sections(historicalExpected);
  let result = historicalExpected;
  for (let index = formatted.length - 1; index >= 0; index -= 1) {
    const target = formatted[index];
    const original = originals[index];
    if (!original || original.name !== target.name) throw new Error('Unexpected section fixture');
    const lineStart = source.lastIndexOf('\n', original.start - 1) + 1;
    const targetLineStart = result.lastIndexOf('\n', target.start - 1) + 1;
    const preserveIndent = /^[\t ]*$/.test(source.slice(lineStart, original.start)) &&
      /^[\t ]*$/.test(result.slice(targetLineStart, target.start));
    result = result.slice(0, preserveIndent ? targetLineStart : target.start) +
      source.slice(preserveIndent ? lineStart : original.start, original.end) + result.slice(target.end);
  }
  return result;
}
