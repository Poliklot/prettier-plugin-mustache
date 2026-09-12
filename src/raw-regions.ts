/** Source boundaries, not an HTML tree builder. Opaque regions must never be
 * interpreted as outer HTML/Mustache layout or delegated to a language printer.
 */
export interface ProtectedRegion {
  start: number;
  end: number;
  tag?: string;
  openEnd?: number;
  closeStart?: number;
  attrsText?: string;
  embeddable?: boolean;
  terminal?: boolean;
}

const protectedTags = new Set([
  'script', 'style', 'textarea', 'title', 'pre', 'xmp', 'iframe',
  'noembed', 'noframes', 'noscript', 'plaintext', 'svg', 'math',
]);
const space = /[\t\n\f\r ]/;

export function discoverProtectedRegions(source: string, templateSpans: { start: number; end: number }[]): ProtectedRegion[] {
  const regions: ProtectedRegion[] = [];
  let spanIndex = 0;
  function templateEnd(position: number): number {
    while (spanIndex < templateSpans.length && templateSpans[spanIndex].end <= position) spanIndex += 1;
    const span = templateSpans[spanIndex];
    return span && span.start <= position ? span.end : position;
  }

  // Quoting is meaningful after '='. Quotes in an unquoted value are not HTML
  // string delimiters. Template tags inside attributes are indivisible source.
  function tagEnd(position: number): number {
    let quote: string | undefined;
    let state: 'beforeName' | 'name' | 'afterName' | 'beforeValue' | 'unquoted' | 'afterValue' = 'beforeName';
    for (let index = position; index < source.length; index += 1) {
      const end = templateEnd(index);
      if (end > index) {
        if (!quote && state === 'beforeValue') state = 'unquoted';
        index = end - 1;
        continue;
      }
      const char = source[index];
      if (quote) {
        if (char === quote) { quote = undefined; state = 'afterValue'; }
      } else if (char === '>') {
        return index + 1;
      } else {
        switch (state) {
          case 'beforeValue':
            if (space.test(char)) break;
            if (char === '"' || char === "'") quote = char;
            else state = 'unquoted';
            break;
          case 'unquoted':
            if (space.test(char)) state = 'beforeName';
            break;
          case 'name':
          case 'afterName':
            if (char === '=') state = 'beforeValue';
            else if (char === '/') state = 'beforeName';
            else if (space.test(char)) state = 'afterName';
            else state = 'name';
            break;
          case 'beforeName':
          case 'afterValue':
            state = space.test(char) || char === '/' ? 'beforeName' : 'name';
            break;
        }
      }
    }
    return source.length;
  }

  function rawClose(tag: string, start: number): { start: number; end: number; escaped: boolean } | undefined {
    // HTML closes raw text independently of JS/CSS quoting. Script's legacy
    // escaped/double-escaped states are boundary-sensitive too; preserve such
    // elements rather than asking Babel to rewrite their HTML comment syntax.
    // https://html.spec.whatwg.org/multipage/parsing.html#script-data-state
    const candidates = new RegExp(`<!--|-->|</?${tag}(?=[\\t\\n\\f\\r />])`, 'gi');
    candidates.lastIndex = start;
    let state: 'data' | 'escaped' | 'double' = 'data';
    let escaped = false;
    for (let match; (match = candidates.exec(source));) {
      const token = match[0].toLowerCase();
      if (tag === 'script') {
        if (token === '<!--' && state === 'data') { state = 'escaped'; escaped = true; }
        else if (token === '-->' && state !== 'data') state = 'data';
        else if (token === '<script' && state === 'escaped') state = 'double';
        else if (token === '</script' && state === 'double') { state = 'escaped'; continue; }
        // The dashes in an escape opener also participate in an immediate
        // '-->' exit (e.g. '<!-->'). Do not skip that overlapping transition.
        if (token === '<!--') candidates.lastIndex = match.index + 2;
      }
      if (token === `</${tag}`) {
        const end = tagEnd(match.index + token.length);
        if (source[end - 1] !== '>') return undefined;
        return { start: match.index, end, escaped };
      }
    }
    return undefined;
  }

  function commentEnd(start: number): number | undefined {
    const close = /--!?>|(?<=<!--)>|(?<=<!---)>/g;
    close.lastIndex = start + 4;
    const match = close.exec(source);
    return match ? match.index + match[0].length : undefined;
  }

  // Unlike raw text, pre/foreign containers can contain nested tags and quoted
  // attributes. Balance explicit same-name elements while treating comments,
  // CDATA and nested raw bodies as opaque. This is deliberately not HTML's
  // implied-element/tree-repair algorithm: ambiguous/unclosed input stays raw.
  function containerClose(tag: string, position: number): { start: number; end: number; escaped: boolean } | undefined {
    let depth = 1;
    while (position < source.length) {
      const start = source.indexOf('<', position);
      if (start === -1) return undefined;
      const end = templateEnd(start);
      if (end > start) { position = end; continue; }
      if (source.startsWith('<!--', start)) { position = commentEnd(start) ?? source.length; continue; }
      if (source.startsWith('<![CDATA[', start)) {
        const close = source.indexOf(']]>', start + 9);
        position = close < 0 ? source.length : close + 3;
        continue;
      }
      const name = source.slice(start).match(/^<\/?([A-Za-z][^\t\n\f\r />]*)/);
      if (!name) { position = start + 1; continue; }
      const nested = name[1].toLowerCase();
      position = tagEnd(start + name[0].length);
      if (nested === tag) {
        if (source[start + 1] === '/') {
          if (--depth === 0) return { start, end: position, escaped: false };
        } else if (tag === 'pre' || !/\/\s*>$/.test(source.slice(start, position))) depth += 1;
      } else if (source[start + 1] !== '/' && protectedTags.has(nested) && !['pre', 'svg', 'math'].includes(nested)) {
        position = rawClose(nested, position)?.end ?? source.length;
      }
    }
    return undefined;
  }

  let position = 0;
  while (position < source.length) {
    const start = source.indexOf('<', position);
    if (start === -1) break;
    const end = templateEnd(start);
    if (end > start) { position = end; continue; }
    if (source.startsWith('<!--', start)) {
      const end = commentEnd(start);
      position = end ?? source.length;
      regions.push({ start, end: position, terminal: end === undefined });
      continue;
    }
    const name = source.slice(start).match(/^<\/?([A-Za-z][^\t\n\f\r />]*)/);
    if (!name) { position = start + 1; continue; }
    const tag = name[1].toLowerCase();
    const openEnd = tagEnd(start + name[0].length);
    position = openEnd;
    if (source[start + 1] === '/' || !protectedTags.has(tag)) continue;
    const attrsText = source.slice(start + name[0].length, openEnd - 1);
    const close = (tag === 'svg' || tag === 'math') && /\/\s*$/.test(attrsText)
      ? { start: openEnd, end: openEnd, escaped: false }
      : tag === 'plaintext' ? undefined : ['pre', 'svg', 'math'].includes(tag)
        ? containerClose(tag, openEnd) : rawClose(tag, openEnd);
    position = close?.end ?? source.length;
    regions.push({
      start, end: position, tag, openEnd, closeStart: close?.start, attrsText, terminal: !close,
      embeddable: (tag === 'script' || tag === 'style') && Boolean(close) &&
        !close?.escaped && !/\/\s*$/.test(attrsText) &&
        new RegExp(`^</${tag}[\\t\\n\\f\\r ]*>$`, 'i').test(source.slice(close?.start, close?.end)),
    });
  }
  for (let index = 0; index + 1 < regions.length; index += 1) {
    const current = regions[index];
    const next = regions[index + 1];
    if (/^<!--\s*prettier-ignore\s*-->$/.test(source.slice(current.start, current.end)) &&
        !source.slice(current.end, next.start).trim()) next.embeddable = false;
  }
  return regions;
}
