'use strict';

// Vexel Lexer — real tokenizer with source positions.
// Recognizes: identifiers, integers, decimals, strings, keywords,
// operators, braces, brackets, commas, dots, slashes, newlines.
// Comments: // to end of line are ignored.

const KEYWORDS = new Set([
  'print', 'if', 'else', 'repeat', 'till',
  'add', 'input', 'set', 'output',
  'function', 'return',
  'r', 'from', 'to',
  'true', 'false',
  'and', 'or', 'not',
  'make', 'upper', 'lower',
  'length', 'of',
  'struct', 'import', 'public',
  'try', 'error',
]);

// Token types
// IDENT, INT, DECIMAL, STRING, KEYWORD(print/if/...), OP, LBRACE, RBRACE,
// LBRACKET, RBRACKET, LPAREN, RPAREN, COMMA, DOT, SLASH, NEWLINE, EOF

function lex(source, filePath) {
  const tokens = [];
  const lines = source.split('\n');
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  function push(type, value, l, c, endCol) {
    tokens.push({ type, value, line: l, column: c, endColumn: endCol, file: filePath });
  }

  while (i < n) {
    const ch = source[i];

    // Comments: // to end of line
    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        i++;
        col++;
      }
      continue;
    }

    // Newlines (handle \r\n and \n)
    if (ch === '\r' && source[i + 1] === '\n') {
      push('NEWLINE', '\n', line, col, col);
      i += 2;
      line++;
      col = 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      push('NEWLINE', '\n', line, col, col);
      i++;
      line++;
      col = 1;
      continue;
    }

    // Whitespace (spaces, tabs) — skip but track columns
    if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f') {
      i++;
      col++;
      continue;
    }

    // Strings: double quotes with escapes
    if (ch === '"') {
      const startCol = col;
      const startLine = line;
      let j = i + 1;
      let val = '';
      let closed = false;
      let ccol = col + 1;
      while (j < n) {
        const c = source[j];
        if (c === '\n' || c === '\r') {
          break; // unterminated — error below
        }
        if (c === '\\' && j + 1 < n) {
          const nx = source[j + 1];
          if (nx === 'n') { val += '\n'; j += 2; ccol += 2; continue; }
          if (nx === 't') { val += '\t'; j += 2; ccol += 2; continue; }
          if (nx === 'r') { val += '\r'; j += 2; ccol += 2; continue; }
          if (nx === '"') { val += '"'; j += 2; ccol += 2; continue; }
          if (nx === '\\') { val += '\\'; j += 2; ccol += 2; continue; }
          // Unknown escape: keep literally
          val += nx;
          j += 2;
          ccol += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          j++;
          ccol++;
          break;
        }
        val += c;
        j++;
        ccol++;
      }
      if (!closed) {
        const { VexelError } = require('../diagnostics/diagnostics.js');
        throw new VexelError({
          type: 'SyntaxError',
          message: 'Unterminated string literal.',
          file: filePath,
          line: startLine,
          column: startCol,
          sourceLine: lines[startLine - 1] || '',
          endColumn: startCol,
        });
      }
      push('STRING', val, startLine, startCol, ccol - 1);
      const consumed = j - i;
      i = j;
      col = ccol;
      void consumed;
      continue;
    }

    // Numbers: integers and decimals
    if ((ch >= '0' && ch <= '9')) {
      const startCol = col;
      let j = i;
      while (j < n && source[j] >= '0' && source[j] <= '9') j++;
      // Decimal? digit(s) . digit(s)
      if (source[j] === '.' && (source[j + 1] >= '0' && source[j + 1] <= '9')) {
        j++; // dot
        while (j < n && source[j] >= '0' && source[j] <= '9') j++;
        const raw = source.slice(i, j);
        push('DECIMAL', raw, line, startCol, startCol + (j - i) - 1);
        col += (j - i);
        i = j;
        continue;
      }
      const raw = source.slice(i, j);
      push('INT', raw, line, startCol, startCol + (j - i) - 1);
      col += (j - i);
      i = j;
      continue;
    }

    // Identifiers / keywords: [A-Za-z_][A-Za-z0-9_]*
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      const startCol = col;
      let j = i;
      while (j < n) {
        const c = source[j];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_') j++;
        else break;
      }
      const word = source.slice(i, j);
      if (KEYWORDS.has(word)) {
        push('KEYWORD', word, line, startCol, startCol + word.length - 1);
      } else {
        push('IDENT', word, line, startCol, startCol + word.length - 1);
      }
      col += (j - i);
      i = j;
      continue;
    }

    // Multi-char operators: == != >= <=
    const two = source.substr(i, 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=') {
      push('OP', two, line, col, col + 1);
      i += 2;
      col += 2;
      continue;
    }

    // Single-char tokens
    switch (ch) {
      case '{': push('LBRACE', ch, line, col, col); i++; col++; continue;
      case '}': push('RBRACE', ch, line, col, col); i++; col++; continue;
      case '[': push('LBRACKET', ch, line, col, col); i++; col++; continue;
      case ']': push('RBRACKET', ch, line, col, col); i++; col++; continue;
      case '(': push('LPAREN', ch, line, col, col); i++; col++; continue;
      case ')': push('RPAREN', ch, line, col, col); i++; col++; continue;
      case ',': push('COMMA', ch, line, col, col); i++; col++; continue;
      case '.': push('DOT', ch, line, col, col); i++; col++; continue;
      case '/': push('SLASH', ch, line, col, col); i++; col++; continue;
      case '+': case '-': case '*': case '%': case '=': case '>': case '<': case '!': case '@':
        push('OP', ch, line, col, col);
        i++;
        col++;
        continue;
      default: {
        const { VexelError } = require('../diagnostics/diagnostics.js');
        throw new VexelError({
          type: 'SyntaxError',
          message: `Unexpected character '${ch}'.`,
          file: filePath,
          line,
          column: col,
          sourceLine: lines[line - 1] || '',
          endColumn: col,
        });
      }
    }
  }

  push('EOF', '', line, col, col);
  return { tokens, lines };
}

module.exports = { lex, KEYWORDS };
