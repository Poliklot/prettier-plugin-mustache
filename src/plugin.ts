import type { SupportLanguage } from 'prettier';
import { locEnd, locStart, parse } from './parser';
import { printer } from './printer';
import type { Node } from './types';

export const languages: SupportLanguage[] = [
  {
    name: 'Mustache',
    parsers: ['mustache'],
    extensions: ['.mustache', '.mst', '.mu'],
    aliases: ['mustache', 'mst', 'mu'],
    vscodeLanguageIds: ['mustache'],
  },
];

export const parsers = {
  mustache: {
    parse,
    astFormat: 'mustache-ast',
    locStart,
    locEnd,
  },
};

export const printers = {
  'mustache-ast': printer,
};

export const options = {};
export const defaultOptions = {};

export type { Node };
