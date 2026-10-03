'use strict';

// Vexel diagnostic error with source context.
// Format:
//   Vexel Error
//   Type: <type>
//   File: <file>
//   Line: <line>
//   Column: <col>
//       <source line>
//       <indicator>

class VexelError extends Error {
  constructor({ type = 'Error', message = 'error', file = '<unknown>', line = 1, column = 1, sourceLine = '', endColumn = null }) {
    super(message);
    this.name = 'VexelError';
    this.vexType = type;
    this.vexFile = file;
    this.vexLine = line;
    this.vexColumn = column;
    this.vexSourceLine = sourceLine;
    this.vexEndColumn = endColumn;
  }

  format() {
    const lines = [];
    lines.push('Vexel Error');
    lines.push('');
    lines.push(`Type: ${this.vexType}`);
    lines.push(`File: ${this.vexFile}`);
    lines.push(`Line: ${this.vexLine}`);
    lines.push(`Column: ${this.vexColumn}`);
    lines.push('');
    if (this.vexSourceLine !== undefined && this.vexSourceLine !== null && this.vexSourceLine !== '') {
      lines.push(`    ${this.vexSourceLine}`);
      lines.push('');
      const col = Math.max(1, this.vexColumn || 1);
      const end = this.vexEndColumn && this.vexEndColumn > col ? this.vexEndColumn : col;
      const len = Math.max(1, end - col + 1);
      // Cap indicator length for readability
      const capped = Math.min(len, 60);
      lines.push(`    ${' '.repeat(col - 1)}${'^'.repeat(capped)}`);
      lines.push('');
    }
    lines.push(this.message);
    return lines.join('\n');
  }
}

function makeError(type, message, token, sourceLines, file) {
  let line = 1;
  let column = 1;
  let sourceLine = '';
  if (token) {
    line = token.line || 1;
    column = token.column || 1;
    if (sourceLines && sourceLines[line - 1] !== undefined) {
      sourceLine = sourceLines[line - 1];
    }
    const endColumn = token.endColumn || null;
    return new VexelError({ type, message, file, line, column, sourceLine, endColumn });
  }
  if (sourceLines && sourceLines[line - 1] !== undefined) {
    sourceLine = sourceLines[line - 1];
  }
  return new VexelError({ type, message, file, line, column, sourceLine });
}

module.exports = { VexelError, makeError };
