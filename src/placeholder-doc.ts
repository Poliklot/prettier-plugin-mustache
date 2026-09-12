import type { Doc } from 'prettier';

interface CheckedDoc {
  doc: Doc;
  markers: string[];
  // Possible literal edges, used only to reject markers split between leaves.
  // Alternatives are not concatenated as though both would be printed.
  heads: Set<string>;
  tails: Set<string>;
}

/** Restore whole-leaf markers only if every layout preserves their occurrences.
 * Correlated ifBreak branches whose individual marker inventories differ are
 * deliberately rejected: a conservative fallback is better than guessing the
 * renderer's group decisions. No particular width is used for validation.
 */
export function restorePlaceholderDoc(value: Doc, replacements: Map<string, string>): Doc | null {
  if (!replacements.size) return value;
  const markers = [...replacements.keys()];
  const prefix = markers[0].match(/^m\d+_/)?.[0];
  if (!prefix || markers.some((marker) => !marker.startsWith(prefix))) return null;
  const pattern = new RegExp(markers.join('|'), 'g');
  const edgeLength = prefix.length - 1;
  const cache = new WeakMap<object, CheckedDoc>();
  const active = new Set<object>();
  const allHeads = new Set<string>();
  const allTails = new Set<string>();
  let hasLineSuffix = false;

  const edges = (text: string) => ({
    heads: new Set([text.slice(0, edgeLength)]),
    tails: new Set([text.slice(-edgeLength)]),
  });
  const empty = (): CheckedDoc => ({ doc: '', markers: [], ...edges('') });
  const sameMarkers = (a: string[], b: string[]) =>
    a.length === b.length && a.every((marker, index) => marker === b[index]);

  function concatenate(left: CheckedDoc, right: CheckedDoc): void {
    for (const tail of left.tails) {
      for (const head of right.heads) {
        if ((tail + head).includes(prefix!)) throw new Error('Split placeholder prefix');
      }
    }
    const heads = new Set<string>();
    const tails = new Set<string>();
    for (const head of left.heads) {
      if (head.length === edgeLength) heads.add(head);
      else for (const next of right.heads) heads.add((head + next).slice(0, edgeLength));
    }
    for (const tail of right.tails) {
      if (tail.length === edgeLength) tails.add(tail);
      else for (const previous of left.tails) tails.add((previous + tail).slice(-edgeLength));
    }
    // Bound pathological custom-printer alternative explosions, not ordinary
    // document size. Rejection selects the documented source fallback.
    if (heads.size > 128 || tails.size > 128) throw new Error('Too many literal edges');
    left.heads = heads;
    left.tails = tails;
    left.markers.push(...right.markers);
  }

  function alternatives(branches: CheckedDoc[]): CheckedDoc {
    const result = { ...branches[0], heads: new Set<string>(), tails: new Set<string>() };
    for (const branch of branches) {
      if (!sameMarkers(result.markers, branch.markers)) throw new Error('Layout-dependent placeholders');
      for (const head of branch.heads) result.heads.add(head);
      for (const tail of branch.tails) result.tails.add(tail);
    }
    return result;
  }

  function visit(part: Doc): CheckedDoc {
    if (typeof part === 'string') {
      const found: string[] = [];
      const restored = part.replace(pattern, (marker) => {
        found.push(marker);
        return replacements.get(marker)!;
      });
      if (restored.includes(prefix!)) throw new Error('Incomplete or unknown placeholder');
      const result = { doc: restored, markers: found, ...edges(part) };
      rememberEdges(result);
      return result;
    }
    const known = cache.get(part);
    if (known) return known;
    if (active.has(part)) throw new Error('Cyclic Doc');
    active.add(part);
    let result: CheckedDoc;
    if (Array.isArray(part)) {
      result = empty();
      const docs: Doc[] = [];
      for (const child of part) {
        const checked = visit(child);
        concatenate(result, checked);
        docs.push(checked.doc);
      }
      result.doc = docs;
    } else {
      switch (part.type) {
        case 'group': {
          const contents = visit(part.contents);
          const states = part.expandedStates?.map(visit);
          result = alternatives([contents, ...(states ?? [])]);
          result.doc = { ...part, contents: contents.doc, ...(states ? { expandedStates: states.map((state) => state.doc) } : {}) };
          break;
        }
        case 'if-break': {
          const broken = visit(part.breakContents);
          const flat = visit(part.flatContents);
          result = alternatives([broken, flat]);
          result.doc = { ...part, breakContents: broken.doc, flatContents: flat.doc };
          break;
        }
        case 'fill': {
          const contents = visit(part.parts);
          result = { ...contents, doc: { ...part, parts: contents.doc as Doc[] } };
          break;
        }
        case 'align':
          if (typeof part.n === 'string' && /\S/.test(part.n)) throw new Error('Text-producing alignment');
          // fall through
        case 'indent':
        case 'indent-if-break':
        case 'label':
        case 'line-suffix': {
          if (part.type === 'line-suffix') hasLineSuffix = true;
          // Prettier 3's declaration omits contents on IndentIfBreak.
          const contents = visit((part as { contents: Doc }).contents);
          result = { ...contents, doc: { ...part, contents: contents.doc } as Doc };
          break;
        }
        case 'line':
          result = { doc: part, markers: [], ...edges('\n') };
          // Softlines can disappear; normal lines cannot join a marker.
          if (part.soft && !part.hard) {
            result.heads.add('');
            result.tails.add('');
          }
          break;
        case 'break-parent':
        case 'cursor':
        case 'line-suffix-boundary':
          result = { ...empty(), doc: part };
          break;
        default:
          throw new Error('Unsupported Doc command');
      }
    }
    active.delete(part);
    rememberEdges(result);
    cache.set(part, result);
    return result;
  }

  function rememberEdges(checked: CheckedDoc): void {
    for (const head of checked.heads) allHeads.add(head);
    for (const tail of checked.tails) allTails.add(tail);
  }

  try {
    const checked = visit(value);
    // Suffixes move relative to the traversal order. Conservatively check all
    // possible edges rather than treating their tree position as output order.
    if (hasLineSuffix) {
      for (let split = 1; split < prefix.length; split += 1) {
        if ([...allTails].some((tail) => tail.endsWith(prefix.slice(0, split))) &&
            [...allHeads].some((head) => head.startsWith(prefix.slice(split)))) return null;
      }
    }
    const unique = new Set(checked.markers);
    return checked.markers.length === markers.length && unique.size === markers.length &&
      markers.every((marker) => unique.has(marker)) ? checked.doc : null;
  } catch {
    return null;
  }
}
