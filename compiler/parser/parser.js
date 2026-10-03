'use strict';

const { n } = require('../ast/ast.js');
const { VexelError } = require('../diagnostics/diagnostics.js');

// Vexel Parser — produces AST from lexer tokens.
// English-like grammar, no semicolons, braces for blocks,
// newlines separate statements. Call args must be on the same
// line as the callee to avoid cross-line capture.

class Parser {
  constructor(tokens, lines, file) {
    this.tokens = tokens;
    this.lines = lines;
    this.file = file;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || this.tokens[this.tokens.length - 1];
  }

  next() {
    const t = this.peek();
    if (t.type !== 'EOF') this.pos++;
    return t;
  }

  atEOF() {
    return this.peek().type === 'EOF';
  }

  isNewline(t) {
    return t && t.type === 'NEWLINE';
  }

  skipNewlines() {
    while (this.peek().type === 'NEWLINE') this.next();
  }

  expect(type, value = null) {
    const t = this.peek();
    if (t.type !== type || (value !== null && t.value !== value)) {
      throw this.err(`Expected ${value !== null ? `'${value}'` : type} but found ${this.describe(t)}.`, t);
    }
    return this.next();
  }

  describe(t) {
    if (!t) return 'end of file';
    if (t.type === 'EOF') return 'end of file';
    if (t.type === 'NEWLINE') return 'newline';
    return `'${t.value}'`;
  }

  err(message, token) {
    const line = token ? token.line : 1;
    return new VexelError({
      type: 'SyntaxError',
      message,
      file: this.file,
      line,
      column: token ? token.column : 1,
      sourceLine: (this.lines && this.lines[line - 1]) || '',
      endColumn: token ? token.endColumn : null,
    });
  }

  parseProgram() {
    this.skipNewlines();
    const body = [];
    while (!this.atEOF()) {
      if (this.peek().type === 'RBRACE') break; // let block parser handle
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      // After each statement, require separator (newline, }, EOF)
      // Allow multiple newlines.
      if (this.peek().type === 'NEWLINE') {
        this.skipNewlines();
      } else if (this.peek().type === 'RBRACE' || this.peek().type === 'EOF') {
        // ok — block end or file end
      } else {
        // Two statements on one line without separator: error unless next starts a block-end
        // To allow `} else` style, don't force; let caller handle.
        // If next token is on same line and is not RBRACE, it's an error.
        const t = this.peek();
        // If previous statement ended and next is on same line, demand newline.
        // We detect by checking if there was no newline consumed.
        // Simplest: throw only if same line as previous statement end.
        // For robustness, just continue (don't hard-error) — semantic will catch.
      }
    }
    return n('Program', { body, file: this.file });
  }

  parseBlock() {
    // Assumes current is LBRACE already consumed? No — expect it.
    const open = this.expect('LBRACE', '{');
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return { body, open };
  }

  parseStatement() {
    this.skipNewlines();
    const t = this.peek();
    if (t.type === 'EOF' || t.type === 'RBRACE') return null;
    // Vexel 2.0: `null` is a reserved literal.
    if (t.type === 'IDENT' && t.value === 'null') {
      const nx = this.tokens[this.pos + 1];
      if (nx && nx.type === 'OP' && nx.value === '=') {
        throw this.err("'null' is reserved and cannot be used as a variable name.", t);
      }
    }

    // Keywords dispatch
    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'import': return this.parseImport();
        case 'public': return this.parsePublic();
        case 'struct': return this.parseStructDecl();
        case 'function': return this.parseFuncDecl(false);
        case 'if': return this.parseIf();
        case 'repeat': return this.parseRepeat();
        case 'try': return this.parseTry();
        case 'return': return this.parseReturn();
        case 'print': return this.parsePrint();
        case 'add': return this.parseAdd();
        case 'set': return this.parseSet();
        case 'make': return this.parseMake();
        case 'error': return this.parseErrorStmt();
        default:
          break;
      }
    }

    // Vexel 2.9 contextual declarations (IDENT shapes only, so existing
    // programs using these words as variables keep working).
    if (t.type === 'IDENT' && t.value === 'enum') {
      const a = this.tokens[this.pos + 1];
      if (a && a.type === 'IDENT') {
        let k = this.pos + 2;
        while (this.tokens[k] && this.tokens[k].type === 'NEWLINE') k++;
        if (this.tokens[k] && this.tokens[k].type === 'LBRACE') return this.parseEnumDecl();
      }
    }
    // Vexel 2.9: test blocks (`test "name" { ... }`, top-level only).
    if (t.type === 'IDENT' && t.value === 'test') {
      const a = this.tokens[this.pos + 1];
      if (a && a.type === 'STRING' && a.line === t.line) {
        let k = this.pos + 2;
        while (this.tokens[k] && this.tokens[k].type === 'NEWLINE') k++;
        if (this.tokens[k] && this.tokens[k].type === 'LBRACE') return this.parseTest();
      }
    }
    // Vexel 2.9: terminal sessions (`terminal { cd ... run ... }`).
    if (t.type === 'IDENT' && t.value === 'terminal') {
      let k = this.pos + 1;
      while (this.tokens[k] && this.tokens[k].type === 'NEWLINE') k++;
      if (this.tokens[k] && this.tokens[k].type === 'LBRACE') return this.parseTerminal();
    }
    if (t.type === 'IDENT' && t.value === 'match') {
      // `match <expr> {` — restore and fall through unless a brace follows.
      const savedMatch = this.pos;
      try {
        this.next(); // match
        if (this.peekValueStart(0)) {
          this.parseExpr();
          const after = this.pos;
          this.skipNewlines();
          if (this.peek().type === 'LBRACE') {
            this.pos = savedMatch;
            return this.parseMatch();
          }
          void after;
        }
      } catch (e) {
        // fall through to normal statement parsing (rethrows there)
      }
      this.pos = savedMatch;
    }

    // Vexel 3.6 Atlas: `move <expr> to gpu|cpu` device transfer.
    // Contextual like `match`: a variable named `move` keeps working.
    if (t.type === 'IDENT' && t.value === 'move') {
      const savedMove = this.pos;
      this.next(); // move
      let committed = false;
      try {
        if (this.peekValueStart(0)) {
          const expr = this.parseExpr();
          const to = this.peek();
          if (to.type === 'KEYWORD' && to.value === 'to') {
            this.next(); // to
            const dev = this.peek();
            if (dev.type === 'IDENT' && (dev.value === 'gpu' || dev.value === 'cpu')) {
              this.next();
              return n('MoveStmt', { expr, device: dev.value, token: t });
            }
            committed = true; // saw `move ... to` — this must be a move
            throw this.err("Expected 'gpu' or 'cpu' after 'to' (e.g. move x to gpu).", dev);
          }
        }
      } catch (e) {
        if (committed) throw e;
        // Not a move statement — restore and parse normally below.
      }
      this.pos = savedMove;
    }

    // Atlas v0.5: `save model <expr> to "<dir>"` — persist a Model as a
    // folder. Peeks only: `save = 5` and `save model` without `to` fall
    // through to normal parsing (the `model` word is the commitment).
    if (t.type === 'IDENT' && t.value === 'save') {
      const s1 = this.tokens[this.pos + 1];
      if (s1 && s1.type === 'IDENT' && s1.value === 'model' && s1.line === t.line && this.peekValueStart(2)) {
        const savedSave = this.pos;
        this.next(); // save
        this.next(); // model
        let committed = false;
        try {
          const value = this.parseExpr();
          const toTok = this.peek();
          if (toTok.type === 'KEYWORD' && toTok.value === 'to') {
            this.next(); // to
            const path = this.parseExpr();
            return n('SaveModelStmt', { value, path, token: t });
          }
          committed = true;
          throw this.err("Expected 'to' after the model value (e.g. save model m to \"my_model\").", toTok);
        } catch (e) {
          if (committed) throw e;
          // Not a save statement — restore and parse normally below.
        }
        this.pos = savedSave;
      }
    }

    // Atlas v0.5: `with inference { ... }` — suppress gradient tracking
    // inside the block (same-line `with inference` + `{` required).
    if (t.type === 'IDENT' && t.value === 'with') {
      const w1 = this.tokens[this.pos + 1];
      if (w1 && w1.type === 'IDENT' && w1.value === 'inference' && w1.line === t.line) {
        const savedWith = this.pos;
        this.next(); // with
        this.next(); // inference
        this.skipNewlines();
        if (this.peek().type === 'LBRACE') {
          const blk = this.parseBlock();
          return n('InferenceStmt', { body: blk.body, token: t });
        }
        // Not `with inference { ... }` — restore.
        this.pos = savedWith;
      }
    }

    // Assignment detection: assignable followed by OP '='
    const saved = this.pos;
    const assignTarget = this.tryParseAssignable();
    if (assignTarget) {
      const nx = this.peek();
      if (nx && nx.type === 'OP' && nx.value === '=') {
        // It's an assignment. Reset and parse properly.
        this.pos = saved;
        return this.parseAssignment();
      }
    }
    this.pos = saved;

    // Vexel 1.1.0 UI statements (contextual shapes only; otherwise normal code)
    const uiStmt = this.tryParseUIStatement();
    if (uiStmt) return uiStmt;

    // Expression statement (usually a function call)
    const exprToken = this.peek();
    const expr = this.parseExpr();
    if (expr.type === 'UIEventRef' && this.peek().type === 'LBRACE') {
      return this.parseUIEventHandler(expr);
    }
    // After expr statement, must be at end of statement
    return n('ExprStmt', { expr, token: exprToken });
  }

  tryParseAssignable() {
    // Parse IDENT/output (. IDENT)* ([ expr ])* without committing errors.
    // Returns target object or null.
    const start = this.pos;
    let t = this.peek();
    let base = null;
    if (t.type === 'IDENT') {
      base = n('VarRef', { name: t.value, token: t });
      this.next();
    } else if (t.type === 'KEYWORD' && t.value === 'output') {
      base = n('OutputRef', { token: t });
      this.next();
    } else if (t.type === 'KEYWORD' && t.value === 'input') {
      // Vexel 1.1.0: `input` may hold a UI input box (input = add an input box)
      base = n('VarRef', { name: 'input', token: t });
      this.next();
    } else {
      this.pos = start;
      return null;
    }
    // Postfix .field and [index] (single level or chain)
    let obj = base;
    while (true) {
      const p = this.peek();
      if (p.type === 'DOT') {
        this.next();
        const f = this.peek();
        if (f.type !== 'IDENT' && f.type !== 'KEYWORD') {
          this.pos = start;
          return null;
        }
        this.next();
        obj = n('FieldAccess', { object: obj, field: f.value, token: p });
        continue;
      }
      if (p.type === 'LBRACKET') {
        // Need to parse index expr — may fail; if so, not assignable
        const save2 = this.pos;
        try {
          this.next(); // [
          // Avoid consuming newlines inside index? Allow.
          this.skipNewlines();
          const idx = this.parseExpr();
          this.skipNewlines();
          if (this.peek().type !== 'RBRACKET') {
            this.pos = start;
            return null;
          }
          const close = this.next();
          obj = n('IndexAccess', { object: obj, index: idx, token: p });
          continue;
        } catch (e) {
          this.pos = start;
          return null;
        }
      }
      break;
    }
    return obj;
  }

  parseAssignment() {
    const target = this.tryParseAssignable();
    if (!target) {
      throw this.err('Expected assignment target.', this.peek());
    }
    const eq = this.expect('OP', '=');
    // RHS must be on same line? Allow multiline? RHS expr can start on same line or next?
    // Require same line or next line (allow `x =\n 10`? Unlikely). Just parse expr.
    this.skipNewlines();
    // Vexel 2.2: `timer = every 1 second { ... }` captures a timer handle.
    // Bare `every/after` keeps its classic fire-and-forget meaning.
    const nx = this.peek();
    if ((nx.type === 'IDENT' || nx.type === 'KEYWORD') && (nx.value === 'every' || nx.value === 'after')) {
      if (target.type !== 'VarRef') {
        throw this.err('A timer handle needs a plain variable (e.g. timer = every 1 second { ... }).', target.token || eq);
      }
      if (target.name === 'output') {
        throw this.err('A timer handle cannot be stored in output. Use a variable (e.g. timer = every 1 second { ... }).', target.token || eq);
      }
      const t = this.next(); // every | after
      const tail = this.parseTimerTail(t);
      tail.handle = target.name;
      tail.handleToken = target.token;
      return n('VarAssign', { target, value: tail, token: eq });
    }
    // Vexel 2.2: `main = create a window titled "Main"` captures a window handle.
    // Other `create` shapes fall through to normal expression parsing.
    const c1 = this.peekIdent(1);
    const c2 = this.peekIdent(2);
    if ((nx.type === 'IDENT' || nx.type === 'KEYWORD') && nx.value === 'create' &&
        c1 && (c1.value === 'a' || c1.value === 'an') && c2 && c2.value === 'window') {
      if (target.type !== 'VarRef') {
        throw this.err('A window handle needs a plain variable (e.g. main = create a window titled "Main").', target.token || eq);
      }
      const cw = this.parseCreate();
      cw.handle = target.name;
      cw.handleToken = target.token;
      return n('VarAssign', { target, value: cw, token: eq });
    }
    const value = this.parseExpr();
    return n('VarAssign', { target, value, token: eq });
  }

  parseTask() {
    const kw = this.next(); // task
    const nameTok = this.next(); // name (validated IDENT by the caller)
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' with the task body after task <name>.", this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('TaskStmt', { name: nameTok.value, nameToken: nameTok, body, token: kw });
  }

  parseTimerTail(t) {
    const once = t.value === 'after';
    const value = this.parseExpr();
    const u = this.peek();
    if (u.type !== 'IDENT' || (u.value !== 'second' && u.value !== 'seconds')) {
      throw this.err("Expected 'second' or 'seconds' after the interval.", u);
    }
    this.next();
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err(`Expected '{' with the timed block after ${t.value} <interval>.`, this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('TimerStmt', { value, once, body, token: t });
  }

  parseImport() {
    const kw = this.expect('KEYWORD', 'import');
    // Path: IDENT (SLASH IDENT)*
    const first = this.peek();
    if (first.type !== 'IDENT') {
      throw this.err('Expected module path after import (e.g. import entities/player).', first);
    }
    const parts = [];
    parts.push(this.next().value);
    while (this.peek().type === 'SLASH') {
      this.next(); // /
      const seg = this.peek();
      if (seg.type !== 'IDENT') {
        throw this.err('Expected path segment after /.', seg);
      }
      parts.push(this.next().value);
    }
    const importPath = parts.join('/');
    let moduleName = parts[parts.length - 1];
    // Vexel 2.0: import entities/player as player
    if (this.peek().type === 'IDENT' && this.peek().value === 'as') {
      this.next(); // as
      const alias = this.peek();
      if (alias.type !== 'IDENT') {
        throw this.err('Expected a name after as (e.g. import entities/player as player).', alias);
      }
      moduleName = this.next().value;
    }
    return n('ImportDecl', { path: importPath, moduleName, token: kw });
  }

  parsePublic() {
    const kw = this.expect('KEYWORD', 'public');
    this.skipNewlines();
    const nx = this.peek();
    if (nx.type === 'KEYWORD' && nx.value === 'function') {
      const decl = this.parseFuncDecl(true);
      return n('PublicDecl', { decl, token: kw });
    }
    if (nx.type === 'KEYWORD' && nx.value === 'struct') {
      const decl = this.parseStructDecl();
      decl.isPublic = true;
      return n('PublicDecl', { decl, token: kw });
    }
    // Vexel 2.9: public enums (`public` + contextual IDENT 'enum').
    if (nx.type === 'IDENT' && nx.value === 'enum') {
      const decl = this.parseEnumDecl();
      decl.isPublic = true;
      return n('PublicDecl', { decl, token: kw });
    }
    // Otherwise: public <ident> = expr
    if (nx.type === 'IDENT') {
      const assign = this.parseAssignment();
      assign.isPublic = true;
      return n('PublicDecl', { decl: assign, token: kw });
    }
    throw this.err('Expected function, struct, or variable after public.', nx);
  }

  // Vexel 2.9: enums are contextual (IDENT 'enum'), mirroring struct
  // shapes. `enum State { idle running finished }` — values are
  // newline-separated idents, commas allowed.
  parseEnumDecl() {
    const kw = this.next(); // enum
    const nameTok = this.peek();
    if (nameTok.type !== 'IDENT') {
      throw this.err('Expected enum name after enum (e.g. enum State).', nameTok);
    }
    if (nameTok.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as an enum name.", nameTok);
    }
    const name = this.next().value;
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const values = [];
    const seen = new Set();
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const v = this.peek();
      if (v.type !== 'IDENT') {
        throw this.err(`Expected value name inside enum '${name}'.`, v);
      }
      if (v.value === 'null') {
        throw this.err(`'null' is reserved and cannot be an enum value in '${name}'.`, v);
      }
      if (seen.has(v.value)) {
        throw this.err(`Duplicate value '${v.value}' in enum '${name}'.`, v);
      }
      seen.add(v.value);
      values.push({ name: v.value, token: v });
      this.next();
      if (this.peek().type === 'COMMA') this.next();
      this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    if (values.length === 0) {
      throw this.err(`Enum '${name}' needs at least one value (e.g. enum ${name} { idle }).`, kw);
    }
    return n('EnumDecl', { name, values, token: kw, isPublic: false });
  }

  // Vexel 2.9: pattern matching. `match subject { ... }` with literal,
  // Enum.value, bare enum value, null and `_` (default, must be last) arms.
  parseMatchArm() {
    const h = this.peek();
    let pattern = null;
    if (h.type === 'IDENT' && h.value === '_') {
      this.next();
      pattern = n('MatchDefault', { token: h });
    } else if (h.type === 'INT' || h.type === 'DECIMAL' || h.type === 'STRING') {
      const lit = this.next();
      pattern = n('MatchLit', { value: lit.value, litType: h.type, token: h });
    } else if (h.type === 'KEYWORD' && (h.value === 'true' || h.value === 'false')) {
      const lit = this.next();
      pattern = n('MatchLit', { value: lit.value === 'true', litType: 'BOOL', token: h });
    } else if (h.type === 'IDENT' && h.value === 'null') {
      const lit = this.next();
      pattern = n('MatchNull', { token: lit });
    } else if (h.type === 'OP' && h.value === '-') {
      const nx = this.tokens[this.pos + 1];
      if (!nx || (nx.type !== 'INT' && nx.type !== 'DECIMAL') || nx.line !== h.line) {
        throw this.err("Expected a match pattern (value, Enum.value, null or _).", h);
      }
      this.next();
      const lit = this.next();
      pattern = n('MatchLit', { value: '-' + lit.value, litType: nx.type, token: h });
    } else if (h.type === 'IDENT') {
      const first = this.next();
      if (this.peek().type === 'DOT') {
        this.next();
        const second = this.peek();
        if (second.type !== 'IDENT') {
          throw this.err("Expected value name after '.' in match pattern (e.g. State.running).", second);
        }
        this.next();
        pattern = n('MatchEnum', { enumName: first.value, value: second.value, token: first });
      } else {
        pattern = n('MatchBare', { name: first.value, token: first });
      }
    } else {
      throw this.err("Expected a match pattern (value, Enum.value, null or _).", h);
    }
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' with the arm body after match pattern.", this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('MatchArm', { pattern, body, token: pattern.token });
  }

  // Vexel 2.9: `test "name" { ... }` — collected by `vexel test`.
  parseTest() {
    const kw = this.next(); // test
    const nameTok = this.next(); // STRING (shape-checked by caller)
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('TestBlock', { name: nameTok.value, nameToken: nameTok, body, token: kw });
  }

  // Vexel 2.9: terminal sessions hold one persistent working directory.
  // Only `cd` and `run` statements may appear inside the block.
  parseTerminal() {
    const kw = this.next(); // terminal
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const t = this.peek();
      if (t.type === 'IDENT' && t.value === 'cd' && this.peekValueStart(1)) {
        this.next(); // cd
        const dir = this.parseExpr();
        body.push(n('CdStmt', { dir, token: t }));
      } else if (t.type === 'IDENT' && t.value === 'run' && this.peekValueStart(1)) {
        this.next(); // run
        const cmd = this.parseExpr();
        body.push(n('RunStmt', { cmd, token: t }));
      } else {
        throw this.err("Only 'cd' and 'run' are allowed inside terminal { }. (e.g. cd \"C:\\Projects\", run \"dir\")", t);
      }
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    if (body.length === 0) {
      throw this.err('terminal needs at least one cd or run statement.', kw);
    }
    return n('TerminalStmt', { body, token: kw });
  }

  // Vexel 2.9: file/dir statements and expressions (contextual shapes
  // mirroring `json read` / `json write`). Statement forms end the line;
  // value forms (read/exists/size/list) also work inside expressions.
  tryParseFileDir() {
    const t = this.peek();
    if (t.type !== 'IDENT' || (t.value !== 'file' && t.value !== 'dir')) return null;
    const w1 = this.peekIdent(1);
    if (!w1) return null;
    const isFile = t.value === 'file';
    const ops = isFile
      ? ['write', 'read', 'append', 'delete', 'copy', 'move', 'exists', 'size']
      : ['create', 'delete', 'exists', 'list', 'copy', 'move'];
    if (!ops.includes(w1.value)) return null;
    if (!this.peekValueStart(2)) {
      throw this.err(`Expected a value after ${t.value} ${w1.value} (e.g. ${t.value} ${w1.value} "path").`, this.tokens[this.pos + 2] || w1);
    }
    this.next(); // file | dir
    this.next(); // op
    const first = this.parseExpr();
    const op = w1.value;
    if (op === 'write' || op === 'append' || op === 'copy' || op === 'move') {
      this.expectTo();
      const second = this.parseExpr();
      if (op === 'write') return n('FileWriteStmt', { value: first, path: second, token: t });
      if (op === 'append') return n('FileAppendStmt', { value: first, path: second, token: t });
      if (op === 'copy') {
        return isFile
          ? n('FileCopyStmt', { from: first, to: second, token: t })
          : n('DirCopyStmt', { from: first, to: second, token: t });
      }
      return isFile
        ? n('FileMoveStmt', { from: first, to: second, token: t })
        : n('DirMoveStmt', { from: first, to: second, token: t });
    }
    if (op === 'read') return n('FileRead', { path: first, token: t });
    if (op === 'exists') return isFile ? n('FileExists', { path: first, token: t }) : n('DirExists', { path: first, token: t });
    if (op === 'size') return n('FileSize', { path: first, token: t });
    if (op === 'list') return n('DirList', { path: first, token: t });
    if (op === 'delete') return isFile ? n('FileDeleteStmt', { path: first, token: t }) : n('DirDeleteStmt', { path: first, token: t });
    if (op === 'create') return n('DirCreateStmt', { path: first, token: t });
    return null;
  }

  parseMatch() {
    const kw = this.next(); // match
    const subject = this.parseExpr();
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' with match arms after match <value>.", this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const arms = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      arms.push(this.parseMatchArm());
      this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    if (arms.length === 0) {
      throw this.err('match needs at least one arm.', kw);
    }
    return n('MatchStmt', { subject, arms, token: kw });
  }

  parseStructDecl() {
    const kw = this.expect('KEYWORD', 'struct');
    const nameTok = this.peek();
    if (nameTok.type !== 'IDENT') {
      throw this.err('Expected struct name after struct.', nameTok);
    }
    if (nameTok.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as a struct name.", nameTok);
    }
    const name = this.next().value;
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const fields = [];
    const seen = new Set();
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const f = this.peek();
      if (f.type !== 'IDENT') {
        throw this.err('Expected field name inside struct.', f);
      }
      if (seen.has(f.value)) {
        throw this.err(`Duplicate field '${f.value}' in struct '${name}'.`, f);
      }
      seen.add(f.value);
      fields.push({ name: f.value, token: f });
      this.next();
      if (this.peek().type === 'COMMA') this.next();
      this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('StructDecl', { name, fields, token: kw, isPublic: false });
  }

  parseFuncDecl(isPublic) {
    const kw = this.expect('KEYWORD', 'function');
    const nameTok = this.peek();
    // Function names are usually IDENTs, but `add` is a keyword (used by
    // `add input` and list `.add`) and the spec uses `function add`.
    // Accept `add` as a function name as well.
    const isAddKw = nameTok.type === 'KEYWORD' && nameTok.value === 'add';
    if (nameTok.type !== 'IDENT' && !isAddKw) {
      throw this.err('Expected function name after function.', nameTok);
    }
    const name = this.next().value;
    if (name === 'null') {
      throw this.err("'null' is reserved and cannot be used as a function name.", nameTok);
    }
    const funcLine = nameTok.line;
    // Params: IDENTs on same line, comma-separated (commas optional)
    const params = [];
    const seen = new Set();
    while (true) {
      const p = this.peek();
      if (p.type === 'IDENT' && p.value === 'null' && p.line === funcLine) {
        throw this.err("'null' is reserved and cannot be used as a parameter name.", p);
      }
      if (p.type === 'IDENT' && p.line === funcLine) {
        if (seen.has(p.value)) {
          throw this.err(`Duplicate parameter '${p.value}'.`, p);
        }
        seen.add(p.value);
        params.push({ name: p.value, token: p });
        this.next();
        if (this.peek().type === 'COMMA') this.next();
        continue;
      }
      if (p.type === 'COMMA' && p.line === funcLine) {
        // stray comma
        this.next();
        continue;
      }
      break;
    }
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err(`Expected '{' to start function '${name}' body.`, this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('FuncDecl', { name, params, body, token: kw, isPublic: !!isPublic });
  }

  parseIf() {
    const kw = this.expect('KEYWORD', 'if');
    const cond = this.parseExpr();
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' after if condition.", this.peek());
    }
    this.next();
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    const branches = [{ cond, body }];
    let elseBody = null;
    // else / else if chain (allow newlines before else)
    while (true) {
      const save = this.pos;
      this.skipNewlines();
      const e = this.peek();
      if (!(e.type === 'KEYWORD' && e.value === 'else')) {
        this.pos = save;
        break;
      }
      this.next(); // else
      this.skipNewlines();
      const nx = this.peek();
      if (nx.type === 'KEYWORD' && nx.value === 'if') {
        this.next(); // if
        const c2 = this.parseExpr();
        this.skipNewlines();
        if (this.peek().type !== 'LBRACE') {
          throw this.err("Expected '{' after else if condition.", this.peek());
        }
        this.next();
        this.skipNewlines();
        const b2 = [];
        while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
          const s = this.parseStatement();
          if (s) b2.push(s);
          if (this.peek().type === 'NEWLINE') this.skipNewlines();
        }
        this.expect('RBRACE', '}');
        branches.push({ cond: c2, body: b2 });
        continue;
      }
      // plain else
      if (this.peek().type !== 'LBRACE') {
        throw this.err("Expected '{' after else.", this.peek());
      }
      this.next();
      this.skipNewlines();
      const eb = [];
      while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
        const s = this.parseStatement();
        if (s) eb.push(s);
        if (this.peek().type === 'NEWLINE') this.skipNewlines();
      }
      this.expect('RBRACE', '}');
      elseBody = eb;
      break;
    }
    return n('IfStmt', { branches, elseBody, token: kw });
  }

  parseRepeat() {
    const kw = this.expect('KEYWORD', 'repeat');
    const nx = this.peek();
    if (nx.type === 'KEYWORD' && nx.value === 'till') {
      this.next(); // till
      const cond = this.parseExpr();
      this.skipNewlines();
      if (this.peek().type !== 'LBRACE') {
        throw this.err("Expected '{' after repeat condition.", this.peek());
      }
      this.next();
      this.skipNewlines();
      const body = [];
      while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
        const s = this.parseStatement();
        if (s) body.push(s);
        if (this.peek().type === 'NEWLINE') this.skipNewlines();
      }
      this.expect('RBRACE', '}');
      return n('RepeatTill', { cond, body, token: kw });
    }
    // Count form: repeat <expr> { }
    const count = this.parseExpr();
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' after repeat count.", this.peek());
    }
    this.next();
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('RepeatCount', { count, body, token: kw });
  }

  parseTry() {
    const kw = this.expect('KEYWORD', 'try');
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' after try.", this.peek());
    }
    this.next();
    this.skipNewlines();
    const tryBody = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) tryBody.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    this.skipNewlines();
    const e = this.peek();
    if (!(e.type === 'KEYWORD' && e.value === 'error')) {
      throw this.err("Expected 'error { ... }' after try block.", e);
    }
    this.next(); // error
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' after error.", this.peek());
    }
    this.next();
    this.skipNewlines();
    const catchBody = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) catchBody.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('TryStmt', { tryBody, catchBody, token: kw });
  }

  parseReturn() {
    const kw = this.expect('KEYWORD', 'return');
    const nx = this.peek();
    // Void return if end of statement
    if (nx.type === 'NEWLINE' || nx.type === 'RBRACE' || nx.type === 'EOF') {
      return n('ReturnStmt', { value: null, token: kw });
    }
    // Value must be on same line
    if (nx.line !== kw.line) {
      return n('ReturnStmt', { value: null, token: kw });
    }
    const value = this.parseExpr();
    return n('ReturnStmt', { value, token: kw });
  }

  parseErrorStmt() {
    const kw = this.expect('KEYWORD', 'error');
    const nx = this.peek();
    if (nx.type === 'LBRACE') {
      throw this.err("Unexpected 'error { ... }' without try.", nx);
    }
    if (nx.type === 'NEWLINE' || nx.type === 'RBRACE' || nx.type === 'EOF' || nx.line !== kw.line) {
      // Bare `error` as expression statement
      return n('ExprStmt', { expr: n('ErrorRef', { token: kw }), token: kw });
    }
    const value = this.parseExpr();
    return n('RaiseStmt', { value, token: kw });
  }

  parseAddInput() {
    const kw = this.expect('KEYWORD', 'add');
    const nx = this.peek();
    if (!(nx.type === 'KEYWORD' && nx.value === 'input')) {
      throw this.err("Expected 'input' after add (e.g. add input \"prompt\").", nx);
    }
    this.next(); // input
    const after = this.peek();
    if (after.type === 'NEWLINE' || after.type === 'RBRACE' || after.type === 'EOF') {
      throw this.err('Expected prompt after add input.', after);
    }
    const prompt = this.parseExpr();
    return n('InputStmt', { prompt, token: kw });
  }

  parseSetOutput() {
    const kw = this.expect('KEYWORD', 'set');
    const o = this.peek();
    if (!(o.type === 'KEYWORD' && o.value === 'output')) {
      throw this.err("Expected 'output' after set (e.g. set output = x).", o);
    }
    this.next(); // output
    const eq = this.peek();
    if (!(eq.type === 'OP' && eq.value === '=')) {
      throw this.err("Expected '=' after set output (e.g. set output = x).", eq);
    }
    this.next(); // =
    const dest = this.peek();
    if (dest.type !== 'IDENT') {
      throw this.err('Expected variable name after set output = .', dest);
    }
    this.next();
    return n('SetOutputStmt', { dest: dest.value, destToken: dest, token: kw });
  }

  parseMake() {
    const kw = this.expect('KEYWORD', 'make');
    const target = this.peek();
    if (target.type !== 'IDENT' && !(target.type === 'KEYWORD' && (target.value === 'input' || target.value === 'output'))) {
      throw this.err('Expected variable name after make.', target);
    }
    if (target.type === 'IDENT' && target.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as a variable name.", target);
    }
    this.next();
    const mode = this.peek();
    // Vexel 3.5 Atlas: two-word `require gradients` mode.
    if (mode.type === 'IDENT' && mode.value === 'require') {
      const m2 = this.peek(1);
      if (m2 && m2.type === 'IDENT' && m2.value === 'gradients' && m2.line === mode.line) {
        this.next(); // require
        this.next(); // gradients
        return n('MakeStmt', { target: target.value, targetToken: target, mode: 'require-gradients', token: kw });
      }
    }
    // Vexel 2.0: upper | lower | number | string | boolean (all plain identifiers here).
    const isModeWord = (mode.type === 'KEYWORD' && (mode.value === 'upper' || mode.value === 'lower')) ||
      (mode.type === 'IDENT' && (mode.value === 'number' || mode.value === 'string' || mode.value === 'boolean'));
    if (!isModeWord) {
      throw this.err("Expected 'upper', 'lower', 'number', 'string', 'boolean' or 'require gradients' after make <name>.", mode);
    }
    this.next();
    return n('MakeStmt', { target: target.value, targetToken: target, mode: mode.value, token: kw });
  }

  parsePrint() {
    const kw = this.expect('KEYWORD', 'print');
    const nx = this.peek();
    if (nx.type === 'NEWLINE' || nx.type === 'RBRACE' || nx.type === 'EOF') {
      throw this.err('Expected expression or file path after print.', nx);
    }
    // File path detection: IDENT (SLASH IDENT)+ (. IDENT)* and then end-of-statement.
    if (nx.type === 'IDENT' && nx.line === kw.line) {
      const save = this.pos;
      try {
        const parts = [];
        parts.push(this.next().value); // first ident
        if (this.peek().type === 'SLASH') {
          while (this.peek().type === 'SLASH') {
            this.next(); // /
            const seg = this.peek();
            if (seg.type !== 'IDENT') throw new Error('not a path');
            parts.push(this.next().value);
          }
          // Optional extension(s): (DOT IDENT)*
          let ext = '';
          while (this.peek().type === 'DOT') {
            const dot = this.peek();
            const afterDot = this.tokens[this.pos + 1];
            if (!afterDot || afterDot.type !== 'IDENT' || afterDot.line !== dot.line) break;
            this.next(); // dot
            ext += '.' + this.next().value;
          }
          const after = this.peek();
          if (after.type === 'NEWLINE' || after.type === 'RBRACE' || after.type === 'EOF') {
            const filePath = parts.join('/') + ext;
            return n('PrintStmt', { isFile: true, filePath, token: kw });
          }
          // If not end-of-statement, fall through to expression parsing.
        }
      } catch (e) {
        // fall through
      }
      this.pos = save;
    }
    const arg = this.parseExpr();
    return n('PrintStmt', { isFile: false, arg, token: kw });
  }

  // ---- Expressions ----

  parseExpr() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (true) {
      const t = this.peek();
      if (t.type === 'KEYWORD' && t.value === 'or') {
        this.next();
        const right = this.parseAnd();
        left = n('BinaryExpr', { op: 'or', left, right, token: t });
        continue;
      }
      break;
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (true) {
      const t = this.peek();
      if (t.type === 'KEYWORD' && t.value === 'and') {
        this.next();
        const right = this.parseNot();
        left = n('BinaryExpr', { op: 'and', left, right, token: t });
        continue;
      }
      break;
    }
    return left;
  }

  parseNot() {
    const t = this.peek();
    if (t.type === 'KEYWORD' && t.value === 'not') {
      this.next();
      const expr = this.parseNot();
      return n('UnaryExpr', { op: 'not', expr, token: t });
    }
    return this.parseComparison();
  }

  isCompOp(t) {
    if (!t) return false;
    if (t.type === 'OP' && (t.value === '==' || t.value === '!=' || t.value === '>' || t.value === '<' || t.value === '>=' || t.value === '<=' || t.value === '=')) return true;
    return false;
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (this.isCompOp(this.peek())) {
      const opTok = this.next();
      let op = opTok.value;
      if (op === '=') op = '==';
      const right = this.parseAdditive();
      left = n('BinaryExpr', { op, left, right, token: opTok });
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (true) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        this.next();
        const right = this.parseMultiplicative();
        left = n('BinaryExpr', { op: t.value, left, right, token: t });
        continue;
      }
      break;
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      // Vexel 3.4 Atlas: `@` is matrix multiplication (same level as `*`).
      if (t.type === 'OP' && (t.value === '*' || t.value === '%' || t.value === '@')) {
        this.next();
        // Vexel 2.0: `50% of window` — percent-of-window (responsive widths).
        if (t.value === '%') {
          const nx = this.peek();
          if (nx.type === 'KEYWORD' && nx.value === 'of') {
            this.next(); // of
            const base = this.parseUnary();
            left = n('PercentOf', { value: left, base, token: t });
            continue;
          }
        }
        const right = this.parseUnary();
        left = n('BinaryExpr', { op: t.value, left, right, token: t });
        continue;
      }
      if (t.type === 'SLASH') {
        this.next();
        const right = this.parseUnary();
        left = n('BinaryExpr', { op: '/', left, right, token: t });
        continue;
      }
      break;
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'OP' && t.value === '-') {
      this.next();
      const expr = this.parseUnary();
      return n('UnaryExpr', { op: '-', expr, token: t });
    }
    return this.parsePostfixCall();
  }

  isExprStart(t) {
    if (!t) return false;
    // Vexel 1.1.0: contextual UI words never start call arguments, so that
    // `set button width to w` style phrases keep working. (Nobody sane
    // passes a variable literally named to/titled/percent/fill.)
    if (t.type === 'IDENT' && (t.value === 'to' || t.value === 'titled' || t.value === 'percent' || t.value === 'fill')) return false;
    if (t.type === 'INT' || t.type === 'DECIMAL' || t.type === 'STRING' || t.type === 'IDENT' || t.type === 'LPAREN' || t.type === 'LBRACKET') return true;
    if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false' || t.value === 'r' || t.value === 'not' || t.value === 'length' || t.value === 'output' || t.value === 'error' || t.value === 'add')) return true;
    // NOTE: OP '-' is deliberately NOT here. '-' starts a unary expression,
    // but after a variable it is almost always binary minus (a - b).
    // Treating it as a call-arg starter misparsed `a - b` as call a(-b).
    // For a negative call arg, use parens: add (-5), 10
    return false;
  }

  parsePostfixCall() {
    let base = this.parsePrimaryHead();
    // Postfix .field and [index]
    while (true) {
      const t = this.peek();
      if (t.type === 'DOT') {
        const dotPos = this.pos;
        this.next(); // .
        const f = this.peek();
        // Vexel 1.1.0: X.on <event> { ... } — event handler reference.
        // Only when an event word (or `key <word>`) is directly followed by `{`.
        if (f.type === 'IDENT' && f.value === 'on') {
          const e1 = this.tokens[dotPos + 2];
          const e2 = this.tokens[dotPos + 3];
          const e3 = this.tokens[dotPos + 4];
          let ev = null;
          let consume = 0;
          if (e1 && e1.type === 'IDENT' && e2 && e2.type === 'LBRACE') {
            ev = e1.value;
            consume = 1;
          } else if (e1 && e1.type === 'IDENT' && e1.value === 'key' && e2 && e2.type === 'IDENT' && e3 && e3.type === 'LBRACE') {
            ev = 'key ' + e2.value;
            consume = 2;
          } else if (e1 && e1.type === 'IDENT' && e1.value === 'mouse' && e2 && e2.type === 'IDENT' && e3 && e3.type === 'LBRACE') {
            ev = 'mouse ' + e2.value;
            consume = 2;
          } else if (e1 && e1.type === 'IDENT' && e1.value === 'double' && e2 && e2.type === 'IDENT' && e2.value === 'click' && e3 && e3.type === 'LBRACE') {
            // Vexel 3.0 Praxis: button.on double click { ... }.
            ev = 'double click';
            consume = 2;
          }
          if (ev !== null) {
            this.next(); // on
            for (let k = 0; k < consume; k++) this.next(); // event word(s)
            base = n('UIEventRef', { target: base, event: ev, token: t });
            continue;
          }
          // else: plain field named `on`
        }
        // Vexel 1.1.0: X.add column/row <v> and X.add a <widget> ...
        // Vexel 2.9: toolbar.add separator | toolbar.add group "Name".
        // (plain X.add <expr> keeps the classic call path below)
        if ((f.type === 'IDENT' || f.type === 'KEYWORD') && f.value === 'add') {
          const a1 = this.tokens[dotPos + 2];
          if (a1 && a1.type === 'IDENT' && (a1.value === 'column' || a1.value === 'row')) {
            this.next(); // add
            this.next(); // column | row
            const v = this.parseExpr();
            base = n('UIAddNode', { base, op: a1.value, value: v, token: t });
            continue;
          }
          if (a1 && a1.type === 'IDENT' && a1.value === 'separator') {
            this.next(); // add
            this.next(); // separator
            base = n('UIAddNode', { base, op: 'separator', token: t });
            continue;
          }
          if (a1 && a1.type === 'IDENT' && a1.value === 'group') {
            this.next(); // add
            this.next(); // group
            const v = this.parseExpr();
            base = n('UIAddNode', { base, op: 'group', value: v, token: t });
            continue;
          }
          if (a1 && a1.type === 'IDENT' && (a1.value === 'a' || a1.value === 'an')) {
            this.next(); // add
            this.next(); // a | an
            const w = this.parseAddWidgetTail();
            base = n('UIAddNode', { base, op: 'widget', widget: w, token: t });
            continue;
          }
        }
        if (f.type !== 'IDENT' && f.type !== 'KEYWORD') {
          throw this.err('Expected field name after ..', f);
        }
        this.next();
        base = n('FieldAccess', { object: base, field: f.value, fieldToken: f, token: t });
        continue;
      }
      if (t.type === 'LBRACKET') {
        // Vexel 3.4 Atlas: tensor [...] / zeros [...] / ones [...]
        // construct tensors (comma list). A single element over a
        // user-defined name still means plain indexing — semantic
        // rewrites that case, so `zeros[0]` on your own list works.
        if (base.type === 'VarRef' && (base.name === 'tensor' || base.name === 'zeros' || base.name === 'ones')) {
          const cons = base.name;
          const consTok = base.token;
          this.next(); // [
          this.skipNewlines();
          const elements = [];
          if (this.peek().type !== 'RBRACKET') {
            elements.push(this.parseExpr());
            this.skipNewlines();
            while (this.peek().type === 'COMMA') {
              this.next(); // ,
              this.skipNewlines();
              if (this.peek().type === 'RBRACKET') break;
              elements.push(this.parseExpr());
              this.skipNewlines();
            }
          }
          this.expect('RBRACKET', ']');
          base = n('TensorCons', { cons, elements, token: consTok });
          continue;
        }
        // Vexel 3.4 Atlas: x.reshape [...] and random [...] tolerate
        // commas so a multi-element bracket parses; semantic decides
        // (reshape list vs. random guidance). Single elements keep the
        // classic single-expression index path untouched.
        if ((base.type === 'VarRef' && base.name === 'random') ||
            (base.type === 'FieldAccess' && base.field === 'reshape')) {
          this.next(); // [
          this.skipNewlines();
          const first = this.parseExpr();
          this.skipNewlines();
          if (this.peek().type !== 'COMMA') {
            this.expect('RBRACKET', ']');
            base = n('IndexAccess', { object: base, index: first, token: t });
            continue;
          }
          const elements = [first];
          while (this.peek().type === 'COMMA') {
            this.next(); // ,
            this.skipNewlines();
            if (this.peek().type === 'RBRACKET') break;
            elements.push(this.parseExpr());
            this.skipNewlines();
          }
          this.expect('RBRACKET', ']');
          base = n('IndexAccess', { object: base, index: n('ListLit', { elements, token: t }), token: t });
          continue;
        }
        this.next(); // [
        this.skipNewlines();
        const idx = this.parseExpr();
        this.skipNewlines();
        const close = this.expect('RBRACKET', ']');
        base = n('IndexAccess', { object: base, index: idx, token: t });
        continue;
      }
      break;
    }
    // Call args? Only if base is VarRef or FieldAccess and next starts expr on same line.
    if ((base.type === 'VarRef' || base.type === 'FieldAccess')) {
      const nx = this.peek();
      const baseLine = this.baseLine(base);
      if (nx && this.isExprStart(nx) && nx.line === baseLine) {
        // Avoid treating `x [0]`? That's index, but already handled as postfix.
        // Parse arg list: expr (, expr)*
        const args = [];
        const first = this.parseExpr();
        args.push(first);
        while (this.peek().type === 'COMMA') {
          this.next(); // ,
          this.skipNewlines();
          const a = this.parseExpr();
          args.push(a);
        }
        return n('CallExpr', { callee: base, args, token: base.token });
      }
    }
    return base;
  }

  baseLine(base) {
    // Line of last token of base (for same-line call detection)
    if (base.type === 'VarRef' || base.type === 'OutputRef' || base.type === 'ErrorRef') {
      return base.token.line;
    }
    if (base.type === 'FieldAccess') {
      return base.fieldToken ? base.fieldToken.line : base.token.line;
    }
    if (base.type === 'IndexAccess') {
      // Approximate: use object's line? Better: current peek line? Use index end?
      // For `a[0]` method call `a[0] arg`? Rare. Use peek line fallback.
      return base.token.line;
    }
    return base.token ? base.token.line : this.peek().line;
  }

  // ================= Vexel 1.1.0 UI syntax =================
  // All UI dispatch is contextual (no new reserved keywords) so that
  // existing programs keep working. Shape-checks only peek; real
  // parsing errors still propagate (no silent backtracking).

  peekIdent(off) {
    const t = this.tokens[this.pos + off];
    if (t && t.type === 'IDENT') return t;
    return null;
  }

  // True when the token at offset can start an expression value
  // (for value-led statements like `wait 2 seconds`).
  peekValueStart(off, allowBrace) {
    const t = this.tokens[this.pos + off];
    if (!t || t.type === 'NEWLINE' || t.type === 'RBRACE' || t.type === 'EOF' || t.type === 'COMMA') return false;
    if (allowBrace && t.type === 'LBRACE') return true;
    if (t.type === 'INT' || t.type === 'DECIMAL' || t.type === 'STRING' || t.type === 'IDENT' || t.type === 'LPAREN' || t.type === 'LBRACKET') return true;
    if (t.type === 'KEYWORD' && ['true', 'false', 'r', 'not', 'length', 'output', 'error', 'add'].includes(t.value)) return true;
    if (t.type === 'OP' && t.value === '-') return true;
    return false;
  }

  tryParseUIStatement() {
    const t = this.peek();
    if (t.type !== 'IDENT') return null;
    const w1 = this.peekIdent(1);
    switch (t.value) {
      case 'create':
        if (w1 && (w1.value === 'a' || w1.value === 'an')) {
          const w2 = this.peekIdent(2);
          if (w2 && ['window', 'container', 'horizontal', 'vertical', 'grid', 'scroll'].includes(w2.value)) {
            return this.parseCreate();
          }
        }
        return null;
      case 'center': {
        if (!w1) return null;
        return this.parseCenter();
      }
      case 'use': {
        if (w1 && w1.value === 'theme') return this.parseUseTheme();
        return null;
      }
      case 'show': {
        if (w1 && (w1.value === 'message' || w1.value === 'warning' || w1.value === 'confirmation' || w1.value === 'confirm')) return this.parseShowDialog();
        if (w1 && (w1.value === 'a' || w1.value === 'an')) {
          const w2 = this.peekIdent(2);
          if (w2 && (w2.value === 'message' || w2.value === 'warning' || w2.value === 'confirmation' || w2.value === 'confirm')) return this.parseShowDialog();
          // Vexel 3.0 Praxis: show an input dialog "..." (`input` is a keyword token).
          const w2raw = this.tokens[this.pos + 2];
          if (w2raw && w2raw.value === 'input') return this.parseShowDialog();
        }
        // Vexel 3.0 Praxis: show input dialog "..." (no article, `input` is a keyword).
        {
          const w1raw = this.tokens[this.pos + 1];
          if (w1raw && w1raw.value === 'input') return this.parseShowDialog();
        }
        // Vexel 3.0 Praxis: show notification ["kind"] "text" [for N seconds].
        if (w1 && w1.value === 'notification' && w1.line === t.line) return this.parseShowNotification();
        return null;
      }
      case 'animate':
      case 'fade': {
        if (!w1) return null;
        return t.value === 'animate' ? this.parseAnimate() : this.parseFade();
      }
      case 'component': {
        if (!w1) return null;
        return this.parseComponent();
      }
      case 'theme': {
        if (!w1) return null;
        return this.parseTheme();
      }
      case 'remove': {
        if (!w1) return null;
        this.next(); // remove
        const target = this.parseUITarget();
        return n('RemoveStmt', { target, token: t });
      }
      case 'wait': {
        if (!this.peekValueStart(1)) return null;
        this.next(); // wait
        const value = this.parseExpr();
        const u = this.peek();
        if (u.type === 'IDENT' && (u.value === 'second' || u.value === 'seconds')) {
          this.next();
          return n('WaitStmt', { value, token: t });
        }
        // Vexel 2.9: `wait <task handle>` blocks until the task finishes.
        return n('WaitTaskStmt', { handle: value, token: t });
      }
      case 'every':
      case 'after': {
        if (!this.peekValueStart(1)) return null;
        const t = this.next(); // every | after
        return this.parseTimerTail(t);
      }
      case 'task': {
        // Vexel 2.2 phase 7: `task name { ... }` declares a background task.
        // Anything else starting with `task` falls through (it stays an
        // ordinary identifier): require IDENT + `{` ahead.
        const n1 = this.tokens[this.pos + 1];
        if (!n1 || n1.type !== 'IDENT') return null;
        if (n1.value === 'null') return null;
        let k = this.pos + 2;
        while (this.tokens[k] && this.tokens[k].type === 'NEWLINE') k++;
        if (!this.tokens[k] || this.tokens[k].type !== 'LBRACE') return null;
        return this.parseTask();
      }
      case 'style': {
        if (!w1) return null;
        return this.parseStyle();
      }
      case 'copy': {
        // `copy <expr>` — clipboard copy. Bare `copy` stays an identifier.
        const nx = this.tokens[this.pos + 1];
        if (!nx || nx.type === 'NEWLINE' || nx.type === 'RBRACE' || nx.type === 'EOF' || nx.type === 'COMMA') return null;
        this.next(); // copy
        const value = this.parseExpr();
        return n('CopyStmt', { value, token: t });
      }
      case 'file':
      case 'dir': {
        // Vexel 2.9: file/dir statements and value forms.
        const fd = this.tryParseFileDir();
        if (!fd) return null;
        if (fd.type === 'FileRead' || fd.type === 'FileExists' || fd.type === 'FileSize' || fd.type === 'DirExists' || fd.type === 'DirList') {
          return n('ExprStmt', { expr: fd, token: t });
        }
        return fd;
      }
      case 'cd': {
        // Vexel 2.9: `cd <dir>` — terminal sessions only (checked later).
        if (!this.peekValueStart(1)) return null;
        this.next(); // cd
        const dir = this.parseExpr();
        return n('CdStmt', { dir, token: t });
      }
      case 'run': {
        // Vexel 2.9: `run <cmd>` statement (captured stdout is shown).
        if (!this.peekValueStart(1)) return null;
        this.next(); // run
        const cmd = this.parseExpr();
        return n('RunStmt', { cmd, token: t });
      }
      case 'http': {
        // Vexel 2.9: `http timeout <seconds>` sets the request timeout.
        const h1 = this.peekIdent(1);
        if (h1 && h1.value === 'timeout' && h1.line === t.line && this.peekValueStart(2)) {
          this.next(); // http
          this.next(); // timeout
          const secs = this.parseExpr();
          return n('HttpTimeoutStmt', { secs, token: t });
        }
        return null;
      }
      case 'assert': {
        // Vexel 2.9: `assert <boolean expr>` — runtime check for tests
        // and preconditions. Bare `assert` stays an ordinary identifier.
        if (!this.peekValueStart(1)) return null;
        this.next(); // assert
        const cond = this.parseExpr();
        return n('AssertStmt', { cond, token: t });
      }
      case 'json': {
        // `json write <value> to <path>` or bare `json read <path>`.
        if (!w1) return null;
        if (w1.value === 'write') {
          this.next(); // json
          this.next(); // write
          const value = this.parseExpr();
          this.expectTo();
          const jpath = this.parseExpr();
          return n('JsonWriteStmt', { value, path: jpath, token: t });
        }
        if (w1.value === 'read') {
          this.next(); // json
          this.next(); // read
          const jpath = this.parseExpr();
          return n('ExprStmt', { expr: n('JsonRead', { path: jpath, token: t }), token: t });
        }
        return null;
      }
      default:
        return null;
    }
  }

  isTo(t) {
    // `to` lexes as a keyword (r from 1 to 100) — accept both forms.
    return t && (t.type === 'IDENT' || t.type === 'KEYWORD') && t.value === 'to';
  }

  expectTo() {
    const t = this.peek();
    if (!this.isTo(t)) {
      throw this.err("Expected 'to' here.", t);
    }
    this.next();
  }

  parseUITarget() {
    const t = this.peek();
    // NOTE: `input`/`output` lex as keywords but may hold UI elements.
    if (t.type !== 'IDENT' && !(t.type === 'KEYWORD' && (t.value === 'input' || t.value === 'output'))) {
      throw this.err('Expected a UI element (e.g. button, container, window).', t);
    }
    this.next();
    let node = n('VarRef', { name: t.value, token: t });
    while (this.peek().type === 'DOT') {
      const dot = this.next();
      const f = this.peek();
      if (f.type !== 'IDENT' && f.type !== 'KEYWORD') {
        throw this.err('Expected a name after ..', f);
      }
      this.next();
      node = n('FieldAccess', { object: node, field: f.value, fieldToken: f, token: dot });
    }
    return node;
  }

  isWidgetWord(t) {
    if (!t) return false;
    if (t.type === 'IDENT') {
      return ['button', 'text', 'checkbox', 'slider', 'dropdown', 'list', 'image', 'menu', 'toolbar', 'table', 'tree', 'spinner', 'input', 'output', 'progress', 'tab', 'panel', 'form', 'scroll', 'switch', 'radio', 'numeric', 'search', 'card', 'status', 'separator', 'context'].includes(t.value);
    }
    // `input`/`output` lex as keywords
    if (t.type === 'KEYWORD') {
      return t.value === 'input' || t.value === 'output';
    }
    return false;
  }

  parseCreate() {
    const kw = this.next(); // create
    return this.parseCreateRest(kw);
  }

  parseCreateRest(kw) {
    this.next(); // a | an
    const w = this.peek();
    if (w.type !== 'IDENT') throw this.err("Expected 'window' or a container after create a/an.", w);
    if (w.value === 'window') {
      this.next();
      let title = null;
      const nx = this.peek();
      if (nx.type === 'IDENT' && nx.value === 'titled') {
        this.next();
        title = this.parseExpr();
      }
      return n('CreateWindow', { title, token: kw });
    }
    let layout = null;
    if (w.value === 'container') {
      this.next();
      layout = 'plain';
    } else if (['horizontal', 'vertical', 'grid', 'scroll'].includes(w.value)) {
      layout = this.next().value;
      const c = this.peek();
      if (c.type !== 'IDENT' || c.value !== 'container') {
        throw this.err(`Expected 'container' after '${layout}'.`, c);
      }
      this.next();
    } else {
      throw this.err(`Cannot create '${w.value}'. Create a window or a container (e.g. create a window titled "Hi").`, w);
    }
    return n('CreateContainer', { layout, token: kw });
  }

  parseAddWidgetTail() {
    const w = this.peek();
    // NOTE: `input` and `output` lex as keywords — accept them as widget words.
    const wIsWord = w.type === 'IDENT' || (w.type === 'KEYWORD' && (w.value === 'input' || w.value === 'output'));
    if (!wIsWord) {
      throw this.err('Expected a widget after add a/an (button, text, input box, output box, checkbox, slider, progress bar, dropdown, list, image, menu, toolbar, tab bar, table, tree, spinner).', w);
    }
    const w1 = w.value;
    this.next();
    let kind = null;
    let layout = null;
    const two = { input: 'box', output: 'box', progress: 'bar', tab: 'bar', scroll: 'area', radio: 'button', numeric: 'input', search: 'box', status: 'bar', context: 'menu' };
    if (two[w1]) {
      const w2 = this.peek();
      // Vexel 3.0 Praxis: `input` lexes as a keyword, not IDENT.
      if (!((w2.type === 'IDENT' || w2.type === 'KEYWORD') && w2.value === two[w1])) {
        throw this.err(`Expected '${two[w1]}' after '${w1}' (e.g. add an ${w1} ${two[w1]}).`, w2);
      }
      this.next();
      if (w1 === 'scroll') {
        kind = 'container';
        layout = 'scroll';
      } else {
        kind = w1 === 'input' ? 'input' : w1 === 'output' ? 'output' : w1 === 'progress' ? 'progress' : w1 === 'radio' ? 'radio' : w1 === 'numeric' ? 'numeric' : w1 === 'search' ? 'search' : w1 === 'status' ? 'statusbar' : w1 === 'context' ? 'contextmenu' : 'tabbar';
      }
    } else {
      const singles = {
        button: 'button', text: 'text', checkbox: 'checkbox', slider: 'slider',
        dropdown: 'dropdown', list: 'listbox', image: 'image', menu: 'menu',
        toolbar: 'toolbar', table: 'table', tree: 'tree', spinner: 'spinner',
        panel: 'container', form: 'container', switch: 'switch', card: 'card',
        separator: 'separator',
      };
      if (!singles[w1]) {
        throw this.err(`Unknown widget '${w1}'. Expected button, text, input box, output box, checkbox, slider, progress bar, dropdown, list, image, menu, toolbar, tab bar, table, tree, spinner, panel, scroll area, form, switch, radio button, numeric input, search box, card, status bar, separator or context menu.`, w);
      }
      kind = singles[w1];
      if (kind === 'container') layout = 'plain';
    }
    let title = null;
    let source = null;
    const nx = this.peek();
    if (kind === 'image') {
      if (nx.type === 'IDENT' && nx.value === 'titled') {
        throw this.err('An image takes a source path, e.g. add an image "logo.png".', nx);
      }
      if (nx.type === 'NEWLINE' || nx.type === 'RBRACE' || nx.type === 'EOF' || nx.type === 'COMMA') {
        throw this.err('An image needs a source path, e.g. add an image "logo.png".', nx);
      }
      source = this.parseExpr();
    } else if (nx.type === 'IDENT' && nx.value === 'titled') {
      this.next();
      title = this.parseExpr();
    }
    return { kind, title, source, layout };
  }

  parseAddWidgetValue(addTok, allowTo) {
    const w = this.parseAddWidgetTail();
    let to = null;
    if (allowTo && this.isTo(this.peek())) {
      this.next();
      to = this.parseUITarget();
    }
    return n('AddWidget', { kind: w.kind, title: w.title, source: w.source, layout: w.layout, to, token: addTok });
  }

  parseAdd() {
    const kw = this.expect('KEYWORD', 'add');
    const nx = this.peek();
    if (nx.type === 'KEYWORD' && nx.value === 'input') {
      this.next(); // input (classic Vexel 1.0 input)
      const after = this.peek();
      if (after.type === 'NEWLINE' || after.type === 'RBRACE' || after.type === 'EOF') {
        throw this.err('Expected prompt after add input.', after);
      }
      const prompt = this.parseExpr();
      return n('InputStmt', { prompt, token: kw });
    }
    if (nx.type === 'IDENT' && (nx.value === 'a' || nx.value === 'an')) {
      // Only a real widget phrase (a/an + widget word) goes the UI route,
      // so that `add` keeps its classic meaning everywhere else.
      const wword = this.tokens[this.pos + 1];
      if (!this.isWidgetWord(wword)) {
        throw this.err('Expected \'input\' or \'a/an <widget>\' after add (e.g. add a button titled "Hi").', nx);
      }
      this.next();
      const val = this.parseAddWidgetValue(kw, true);
      return n('ExprStmt', { expr: val, token: kw });
    }
    if (nx.type === 'IDENT') {
      const target = this.parseUITarget();
      if (this.isTo(this.peek())) {
        this.next();
        const dst = this.parseUITarget();
        return n('AddToContainer', { value: target, target: dst, token: kw });
      }
      if (target.type === 'VarRef') {
        return n('ComponentUse', { name: target.name, token: kw });
      }
      throw this.err("Expected 'to <container>' after add <element>.", this.peek());
    }
    throw this.err('Expected \'input\' or \'a/an ...\' after add (e.g. add a button titled "Hi").', nx);
  }

  parseSet() {
    const kw = this.expect('KEYWORD', 'set');
    const nx = this.peek();
    // Vexel 2.0: `set theme to "dark"` (alternate theme syntax).
    if (nx.type === 'IDENT' && nx.value === 'theme') {
      const after = this.tokens[this.pos + 1];
      if (after && ((after.type === 'IDENT' && after.value === 'to') || (after.type === 'KEYWORD' && after.value === 'to'))) {
        this.next(); // theme
        this.next(); // to
        const name = this.parseExpr();
        return n('UIUseTheme', { name, token: kw });
      }
      // else: a variable literally named theme — normal UI setter path below.
    }
    if (nx.type === 'KEYWORD' && nx.value === 'output') {
      this.next(); // output (classic Vexel 1.0: set output = x)
      const eq = this.peek();
      if (!(eq.type === 'OP' && eq.value === '=')) {
        throw this.err("Expected '=' after set output (e.g. set output = x).", eq);
      }
      this.next(); // =
      const dest = this.peek();
      if (dest.type !== 'IDENT' && !(dest.type === 'KEYWORD' && (dest.value === 'input' || dest.value === 'output'))) {
        throw this.err('Expected variable name after set output = .', dest);
      }
      if (dest.type === 'IDENT' && dest.value === 'null') {
        throw this.err("'null' is reserved and cannot be used as a variable name.", dest);
      }
      this.next();
      return n('SetOutputStmt', { dest: dest.value, destToken: dest, token: kw });
    }
    const target = this.parseUITarget();
    const p = this.peek();
    if (p.type === 'IDENT' && (p.value === 'min' || p.value === 'max')) {
      const which = this.next().value;
      const dim = this.peek();
      if (dim.type !== 'IDENT' || (dim.value !== 'width' && dim.value !== 'height')) {
        throw this.err("Expected 'width' or 'height' after min/max.", dim);
      }
      this.next();
      this.expectTo();
      const val = this.parseExpr();
      return n('UISetMinMax', { target, which, dim: dim.value, value: val, token: kw });
    }
    if (p.type === 'IDENT' && p.value === 'position') {
      this.next();
      this.expectTo();
      const vx = this.parseExpr();
      this.expect('COMMA', ',');
      const vy = this.parseExpr();
      return n('UISetPosition', { target, x: vx, y: vy, token: kw });
    }
    if (p.type !== 'IDENT') {
      throw this.err('Expected a property after set <element> (e.g. set window width to 800).', p);
    }
    const prop = this.next().value;
    this.expectTo();
    // `set X alignment to center` — bare alignment words read as strings.
    if (prop === 'alignment') {
      const av = this.peek();
      if (av.type === 'IDENT' && ['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(av.value)) {
        this.next();
        return n('UISetProp', { target, prop, value: n('StrLit', { value: av.value, token: av }), unit: null, token: kw });
      }
    }
    const v = this.peek();
    if (v.type === 'IDENT' && v.value === 'fill') {
      this.next();
      return n('UISetProp', { target, prop, value: null, unit: 'fill', token: kw });
    }
    const vline = v.line;
    const val = this.parseExpr();
    let unit = null;
    const pu = this.peek();
    if (pu.type === 'IDENT' && pu.value === 'percent' && pu.line === vline) {
      this.next();
      unit = 'percent';
    }
    return n('UISetProp', { target, prop, value: val, unit, token: kw });
  }

  parseCenter() {
    const kw = this.next(); // center
    const target = this.parseUITarget();
    let inTarget = null;
    if (this.peek().type === 'IDENT' && this.peek().value === 'in') {
      this.next();
      inTarget = this.parseUITarget();
    }
    return n('UICenter', { target, inTarget, token: kw });
  }

  parseUseTheme() {
    const kw = this.next(); // use
    this.next(); // theme
    const name = this.parseExpr();
    return n('UIUseTheme', { name, token: kw });
  }

  parseStyle() {
    const kw = this.next(); // style
    const nameTok = this.peek();
    if (nameTok.type !== 'IDENT') {
      throw this.err('Expected a style name after style.', nameTok);
    }
    if (nameTok.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as a style name.", nameTok);
    }
    const name = this.next().value;
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const fields = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const fn = this.peek();
      if (fn.type !== 'IDENT') {
        throw this.err(`Expected a style name in style ${name}.`, fn);
      }
      this.next();
      const eq = this.peek();
      if (!(eq.type === 'OP' && eq.value === '=')) {
        throw this.err(`Expected '=' after '${fn.value}' in style ${name}.`, eq);
      }
      this.next(); // =
      this.skipNewlines();
      const val = this.parseExpr();
      fields.push({ name: fn.value, value: val, token: fn });
      if (this.peek().type === 'COMMA') this.next();
      this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('StyleDecl', { name, fields, token: kw });
  }

  parseShowDialog() {
    const kw = this.next(); // show
    // Vexel 2.0: the article is optional (show message "..." works too).
    if (this.peek().type === 'IDENT' && (this.peek().value === 'a' || this.peek().value === 'an')) {
      this.next(); // a | an
    }
    const k = this.peek();
    // Vexel 3.0 Praxis: show input dialog "..." (two-word kind, `input` is a keyword).
    if ((k.type === 'IDENT' || k.type === 'KEYWORD') && k.value === 'input') {
      this.next(); // input
      const d = this.peek();
      if (!d || d.type !== 'IDENT' || d.value !== 'dialog') {
        throw this.err("Expected 'dialog' after show input (e.g. show input dialog \"Name\").", d);
      }
      this.next(); // dialog
      const value = this.parseExpr();
      return n('UIShowDialog', { kind: 'input', value, token: kw });
    }
    if (k.type !== 'IDENT' || (k.value !== 'message' && k.value !== 'warning' && k.value !== 'confirmation' && k.value !== 'confirm')) {
      throw this.err("Expected 'message', 'warning', 'confirmation' or 'input dialog' after show.", k);
    }
    let kind = this.next().value;
    if (kind === 'confirm') kind = 'confirmation';
    const value = this.parseExpr();
    return n('UIShowDialog', { kind, value, token: kw });
  }

  // Vexel 3.0 Praxis notifications:
  //   show notification "Saved"
  //   show notification success "Done"   (success | warning | error)
  //   show notification "Saved" for 5 seconds
  parseShowNotification() {
    const kw = this.next(); // show
    this.next(); // notification
    let kind = 'info';
    let nx = this.peek();
    if (nx.type === 'IDENT' && (nx.value === 'success' || nx.value === 'warning' || nx.value === 'error' || nx.value === 'info') && nx.line === kw.line) {
      kind = this.next().value;
      nx = this.peek();
    }
    const value = this.parseExpr();
    let secs = null;
    const f = this.peek();
    if (f.type === 'IDENT' && f.value === 'for' && f.line === kw.line) {
      this.next(); // for
      const num = this.peek();
      if ((num.type !== 'INT' && num.type !== 'DECIMAL') || num.line !== kw.line) {
        throw this.err("Expected a number of seconds after for (e.g. for 5 seconds).", num);
      }
      secs = this.next();
      const u = this.peek();
      if (u.type !== 'IDENT' || (u.value !== 'second' && u.value !== 'seconds') || u.line !== kw.line) {
        throw this.err("Expected 'second' or 'seconds' after the duration.", u);
      }
      this.next();
    }
    return n('ShowNotification', { kind, value, secs, token: kw });
  }

  parseComponent() {
    const kw = this.next(); // component
    const nameTok = this.peek();
    if (nameTok.type !== 'IDENT') {
      throw this.err('Expected a component name after component.', nameTok);
    }
    if (nameTok.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as a component name.", nameTok);
    }
    const name = this.next().value;
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err(`Expected '{' to start component '${name}' body.`, this.peek());
    }
    this.next(); // {
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('ComponentDecl', { name, body, token: kw });
  }

  parseTheme() {
    const kw = this.next(); // theme
    const nameTok = this.peek();
    if (nameTok.type !== 'IDENT') {
      throw this.err('Expected a theme name after theme.', nameTok);
    }
    if (nameTok.value === 'null') {
      throw this.err("'null' is reserved and cannot be used as a theme name.", nameTok);
    }
    const name = this.next().value;
    this.skipNewlines();
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const fields = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const fn = this.peek();
      if (fn.type !== 'IDENT') {
        throw this.err(`Expected a style name in theme ${name}.`, fn);
      }
      this.next();
      const eq = this.peek();
      if (!(eq.type === 'OP' && eq.value === '=')) {
        throw this.err(`Expected '=' after '${fn.value}' in theme ${name}.`, eq);
      }
      this.next(); // =
      this.skipNewlines();
      const val = this.parseExpr();
      fields.push({ name: fn.value, value: val, token: fn });
      if (this.peek().type === 'COMMA') this.next();
      this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('ThemeDecl', { name, fields, token: kw });
  }

  parseDurationClause() {
    const d = this.peek();
    if (d.type !== 'IDENT' || d.value !== 'duration') {
      throw this.err("Expected 'duration <number> second(s)' here.", d);
    }
    this.next(); // duration
    const val = this.parseExpr();
    const u = this.peek();
    if (u.type !== 'IDENT' || (u.value !== 'second' && u.value !== 'seconds')) {
      throw this.err("Expected 'second' or 'seconds' after the duration.", u);
    }
    this.next();
    return val;
  }

  parseAnimationSteps() {
    const steps = [];
    this.skipNewlines();
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.peek();
      if (s.type !== 'IDENT') throw this.err('Expected move, fade, size, ease or duration in the animation.', s);
      if (s.value === 'move') {
        this.next();
        this.expectTo();
        const ax = this.peek();
        if (ax.type !== 'IDENT' || (ax.value !== 'x' && ax.value !== 'y')) {
          throw this.err("Expected 'x' or 'y' after move to.", ax);
        }
        this.next();
        steps.push({ op: ax.value === 'x' ? 'move-x' : 'move-y', value: this.parseExpr(), token: s });
      } else if (s.value === 'fade') {
        this.next();
        this.expectTo();
        steps.push({ op: 'fade-to', value: this.parseExpr(), token: s });
      } else if (s.value === 'size') {
        this.next();
        this.expectTo();
        const w = this.parseExpr();
        this.expect('COMMA', ',');
        const h = this.parseExpr();
        steps.push({ op: 'size', w, h, token: s });
      } else if (s.value === 'duration') {
        steps.push({ op: 'duration', value: this.parseDurationClause(), token: s });
      } else if (s.value === 'ease') {
        // Vexel 3.0: `ease smooth` (or linear) selects Praxis easing.
        this.next();
        const e = this.peek();
        if (e.type !== 'IDENT') {
          throw this.err("Expected 'linear' or 'smooth' after ease.", e);
        }
        steps.push({ op: 'ease', value: e.value, token: s });
        this.next();
      } else {
        throw this.err(`Unknown animation step '${s.value}'. Expected move, fade, size, ease or duration.`, s);
      }
      this.skipNewlines();
    }
    return steps;
  }

  parseAnimate() {
    const kw = this.next(); // animate
    const target = this.parseUITarget();
    this.skipNewlines();
    if (this.peek().type !== 'LBRACE') {
      throw this.err("Expected '{' with animation steps after animate <element>.", this.peek());
    }
    this.next(); // {
    const steps = this.parseAnimationSteps();
    this.expect('RBRACE', '}');
    return n('UIAnimate', { target, steps, token: kw });
  }

  parseFade() {
    const kw = this.next(); // fade
    const target = this.parseUITarget();
    let to = null;
    if (this.peek().type === 'IDENT' && this.peek().value === 'to') {
      this.next();
      to = this.parseExpr();
    }
    this.skipNewlines();
    let steps;
    if (this.peek().type === 'LBRACE') {
      this.next(); // {
      steps = this.parseAnimationSteps();
      this.expect('RBRACE', '}');
    } else {
      const dur = this.parseDurationClause();
      steps = [{ op: 'fade-to', value: to, token: kw }, { op: 'duration', value: dur, token: kw }];
    }
    return n('UIAnimate', { target, steps, token: kw, isFade: true });
  }

  parseUIEventHandler(ref) {
    this.expect('LBRACE', '{');
    this.skipNewlines();
    const body = [];
    while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
      const s = this.parseStatement();
      if (s) body.push(s);
      if (this.peek().type === 'NEWLINE') this.skipNewlines();
    }
    this.expect('RBRACE', '}');
    return n('UIEventHandler', { target: ref.target, event: ref.event, body, token: ref.token });
  }

  parsePrimaryHead() {
    const t = this.peek();

    if (t.type === 'INT') {
      this.next();
      return n('IntLit', { value: t.value, token: t });
    }
    if (t.type === 'DECIMAL') {
      this.next();
      return n('FloatLit', { value: t.value, token: t });
    }
    if (t.type === 'STRING') {
      this.next();
      return n('StrLit', { value: t.value, token: t });
    }
    if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false')) {
      this.next();
      return n('BoolLit', { value: t.value === 'true', token: t });
    }
    if (t.type === 'KEYWORD' && t.value === 'output') {
      this.next();
      return n('OutputRef', { token: t });
    }
    if (t.type === 'KEYWORD' && t.value === 'error') {
      this.next();
      return n('ErrorRef', { token: t });
    }
    // Vexel 1.1.0: `input` may hold a UI input box (input = add an input box).
    if (t.type === 'KEYWORD' && t.value === 'input') {
      const itok = this.next();
      return n('VarRef', { name: 'input', token: itok });
    }
    // Vexel 2.2 phase 7: `http get "url"` performs a real request.
    // Vexel 2.9: `http <get|post|put|patch|delete> url [, body [, headers]]`
    // and `http timeout <seconds>`. Plain `http` stays an identifier.
    if (t.type === 'IDENT' && t.value === 'http') {
      const h1 = this.tokens[this.pos + 1];
      if (h1 && (h1.type === 'IDENT' || h1.type === 'KEYWORD') && h1.line === t.line) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(h1.value)) {
          const hTok = this.next(); // http
          const method = this.next().value; // method
          const url = this.parseExpr();
          let body = null;
          let headers = null;
          while (this.peek().type === 'COMMA') {
            this.next(); // ,
            this.skipNewlines();
            const a = this.parseExpr();
            if (!body) body = a;
            else if (!headers) headers = a;
            else throw this.err('http takes at most a body and headers after the URL.', this.peek());
          }
          if (method === 'get' && !body && !headers) {
            return n('HttpGet', { url, token: hTok });
          }
          return n('HttpRequest', { method, url, body, headers, token: hTok });
        }
      }
    }
    // Vexel 1.1.0/2.0: `choose a file` / `choose a color` / `choose a folder`.
    // Plain `choose` stays an ordinary identifier.
    if (t.type === 'IDENT' && t.value === 'choose') {
      const c1 = this.tokens[this.pos + 1];
      const c2 = this.tokens[this.pos + 2];
      if (c1 && c1.type === 'IDENT' && (c1.value === 'a' || c1.value === 'an') && c2 && c2.type === 'IDENT' && (c2.value === 'file' || c2.value === 'color' || c2.value === 'folder')) {
        const cTok = this.next(); // choose
        this.next(); // a | an
        const what = this.next().value; // file | color | folder
        return n(what === 'file' ? 'ChooseFile' : what === 'folder' ? 'ChooseFolder' : 'ChooseColor', { token: cTok });
      }
    }
    // `add` is a keyword (add input / list .add) but the spec also uses
    // `function add` and calls like `add 10, 20`. In expression position,
    // treat `add` as an identifier (function reference) — unless it starts
    // a UI widget phrase (button = add a button titled "Hi").
    if (t.type === 'KEYWORD' && t.value === 'add') {
      const nx = this.tokens[this.pos + 1];
      const nnx = this.tokens[this.pos + 2];
      // `add a, b` (function call with a variable called a) must keep
      // working — only a/an + widget word starts a widget phrase.
      if (nx && nx.type === 'IDENT' && (nx.value === 'a' || nx.value === 'an') && this.isWidgetWord(nnx)) {
        const addTok = this.next(); // add
        this.next(); // a | an
        const w = this.parseAddWidgetTail();
        let to = null;
        if (this.isTo(this.peek())) {
          this.next();
          to = this.parseUITarget();
        }
        return n('AddWidget', { kind: w.kind, title: w.title, source: w.source, layout: w.layout, to, token: addTok });
      }
      const ident = this.next();
      return n('VarRef', { name: 'add', token: ident });
    }
    // Vexel 2.0: `event` inside handlers (fields like event.x, event.key).
    // Elsewhere it stays an ordinary identifier.
    if (t.type === 'IDENT' && t.value === 'event') {
      const etok = this.next();
      return n('EventRef', { token: etok });
    }
    // Vexel 2.0: `null` literal.
    if (t.type === 'IDENT' && t.value === 'null') {
      const ntok = this.next();
      return n('NullLit', { token: ntok });
    }
    // Vexel 2.9: `out = run "cmd"` captures stdout; bare `run` stays
    // an ordinary identifier (e.g. a variable or zero-arg call).
    if (t.type === 'IDENT' && t.value === 'run') {
      const r1 = this.tokens[this.pos + 1];
      if (r1 && r1.line === t.line && this.peekValueStart(1)) {
        const rTok = this.next(); // run
        const cmd = this.parseExpr();
        return n('RunExpr', { cmd, token: rTok });
      }
    }
    // Atlas v0.5: `load model "<dir>"` — a Model value in expression
    // position. Plain `load` stays an ordinary identifier.
    if (t.type === 'IDENT' && t.value === 'load') {
      const l1 = this.tokens[this.pos + 1];
      if (l1 && l1.type === 'IDENT' && l1.value === 'model' && l1.line === t.line && this.peekValueStart(2)) {
        const lTok = this.next(); // load
        this.next(); // model
        const lpath = this.parseExpr();
        return n('LoadModelExpr', { path: lpath, token: lTok });
      }
    }
    // Vexel 2.9: `x = file read "p"` / `file exists` / `file size` /
    // `dir exists` / `dir list` inside expressions (same line required).
    if (t.type === 'IDENT' && (t.value === 'file' || t.value === 'dir')) {
      const f1 = this.tokens[this.pos + 1];
      const isFile = t.value === 'file';
      const valOps = isFile ? ['read', 'exists', 'size'] : ['exists', 'list'];
      if (f1 && f1.type === 'IDENT' && valOps.includes(f1.value) && f1.line === t.line && this.peekValueStart(2)) {
        const node = this.tryParseFileDir();
        if (node) return node;
      }
    }
    // Vexel 2.0: `json read "config.json"` (file only).
    if (t.type === 'IDENT' && t.value === 'json') {
      const j1 = this.tokens[this.pos + 1];
      if (j1 && j1.type === 'IDENT' && j1.value === 'read') {
        const jtok = this.next(); // json
        this.next(); // read
        const jpath = this.parseExpr();
        return n('JsonRead', { path: jpath, token: jtok });
      }
    }
    // Atlas v0.5: `model info "<dir>"` — inspect a folder's config without
    // loading weights. Plain `model` stays an ordinary identifier.
    if (t.type === 'IDENT' && t.value === 'model') {
      const m1 = this.tokens[this.pos + 1];
      if (m1 && m1.type === 'IDENT' && m1.value === 'info' && m1.line === t.line && this.peekValueStart(2)) {
        const mTok = this.next(); // model
        this.next(); // info
        const mpath = this.parseExpr();
        return n('ModelInfoExpr', { path: mpath, token: mTok });
      }
    }
    // Vexel 1.1.0: `container = create a container` — create in value position.
    // (`create` alone stays an ordinary identifier.)
    if (t.type === 'IDENT' && t.value === 'create') {
      const c1 = this.tokens[this.pos + 1];
      const c2 = this.tokens[this.pos + 2];
      const isArticle = c1 && c1.type === 'IDENT' && (c1.value === 'a' || c1.value === 'an');
      const isTarget = c2 && c2.type === 'IDENT' && ['window', 'container', 'horizontal', 'vertical', 'grid', 'scroll'].includes(c2.value);
      if (isArticle && isTarget) {
        const kw = this.next(); // create
        return this.parseCreateRest(kw);
      }
      // Atlas v0.5: `create model <config>` — fresh Model from a config
      // object (ObjectLit, json read, or atlas.default_config result).
      const isModel = c1 && c1.type === 'IDENT' && c1.value === 'model' && c1.line === t.line;
      if (isModel && this.peekValueStart(2, true)) {
        const kw = this.next(); // create
        this.next(); // model
        const config = this.parseExpr();
        return n('CreateModelExpr', { config, token: kw });
      }
    }
    if (t.type === 'KEYWORD' && t.value === 'r') {
      // Random: r from <low> to <high>
      const rTok = this.next();
      const f = this.peek();
      if (!(f.type === 'KEYWORD' && f.value === 'from')) {
        throw this.err("Expected 'from' after r (e.g. r from 1 to 100).", f);
      }
      this.next(); // from
      const low = this.parseExpr();
      const to = this.peek();
      if (!(to.type === 'KEYWORD' && to.value === 'to')) {
        throw this.err("Expected 'to' in random expression (e.g. r from 1 to 100).", to);
      }
      this.next(); // to
      const high = this.parseExpr();
      return n('RandomExpr', { low, high, token: rTok });
    }
    if (t.type === 'KEYWORD' && t.value === 'length') {
      const lTok = this.next();
      const o = this.peek();
      if (!(o.type === 'KEYWORD' && o.value === 'of')) {
        throw this.err("Expected 'of' after length (e.g. length of name).", o);
      }
      this.next(); // of
      const expr = this.parseUnary();
      return n('LengthOf', { expr, token: lTok });
    }
    if (t.type === 'LBRACE') {
      // Vexel 2.0: object literal { name = "Zen"  level = 10 }.
      // (`{` never started an expression before, so this is safe.)
      const open = this.next(); // {
      this.skipNewlines();
      const fields = [];
      const seen = new Set();
      while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
        const fn = this.peek();
        if (fn.type !== 'IDENT') {
          throw this.err('Expected a field name (e.g. name = "Zen").', fn);
        }
        if (seen.has(fn.value)) {
          throw this.err(`Duplicate field '${fn.value}'.`, fn);
        }
        seen.add(fn.value);
        this.next();
        const eq = this.peek();
        if (!(eq.type === 'OP' && eq.value === '=')) {
          throw this.err(`Expected '=' after field '${fn.value}'.`, eq);
        }
        this.next(); // =
        this.skipNewlines();
        const val = this.parseExpr();
        fields.push({ name: fn.value, value: val, token: fn });
        if (this.peek().type === 'COMMA') this.next();
        this.skipNewlines();
      }
      this.expect('RBRACE', '}');
      if (fields.length === 0) {
        throw this.err('An object needs at least one field, e.g. { name = "Zen" }.', open);
      }
      return n('ObjectLit', { fields, token: open });
    }
    if (t.type === 'LBRACKET') {
      // List literal or [idx] from base
      const open = this.next(); // [
      this.skipNewlines();
      if (this.peek().type === 'RBRACKET') {
        this.next(); // ]
        return n('ListLit', { elements: [], token: open });
      }
      const first = this.parseExpr();
      this.skipNewlines();
      if (this.peek().type === 'COMMA') {
        // List literal
        const elements = [first];
        while (this.peek().type === 'COMMA') {
          this.next();
          this.skipNewlines();
          if (this.peek().type === 'RBRACKET') break; // trailing comma
          elements.push(this.parseExpr());
          this.skipNewlines();
        }
        this.expect('RBRACKET', ']');
        return n('ListLit', { elements, token: open });
      }
      // Single element: could be CharAt ([idx] from base) or single list
      if (this.peek().type === 'RBRACKET') {
        this.next(); // ]
        const after = this.peek();
        if (after.type === 'KEYWORD' && after.value === 'from') {
          this.next(); // from
          const baseExpr = this.parseUnary();
          return n('CharAt', { index: first, base: baseExpr, token: open });
        }
        // Single-element list
        return n('ListLit', { elements: [first], token: open });
      }
      throw this.err("Expected ',' or ']' in list literal.", this.peek());
    }
    if (t.type === 'LPAREN') {
      this.next(); // (
      this.skipNewlines();
      const e = this.parseExpr();
      this.skipNewlines();
      this.expect('RPAREN', ')');
      return e;
    }
    // `number of x` converts text to a number (like `length of x`).
    // `number` stays an ordinary identifier otherwise, so existing
    // variables named `number` keep working.
    if (t.type === 'IDENT' && t.value === 'number') {
      const nx = this.peek(1);
      if (nx && nx.type === 'KEYWORD' && nx.value === 'of') {
        const numTok = this.next(); // number
        this.next(); // of
        const expr = this.parseUnary();
        return n('NumberOf', { expr, token: numTok });
      }
    }
    // Vexel 3.6 Atlas: `gpu available` / `gpu count` / `gpu name`
    // (contextual, like `number of x`; a variable named `gpu` keeps working).
    if (t.type === 'IDENT' && t.value === 'gpu') {
      const nx = this.peek(1);
      if (nx && nx.type === 'IDENT' && (nx.value === 'available' || nx.value === 'count' || nx.value === 'name')) {
        const gTok = this.next(); // gpu
        this.next(); // available|count|name
        return n('GpuInfo', { info: nx.value, token: gTok });
      }
    }
    if (t.type === 'IDENT') {
      const ident = this.next();
      // Struct instantiation: only for Uppercase type names (Player { ... }).
      // Lowercase idents followed by `{` are block opens (e.g. `if ready {`).
      const startsUpper = ident.value.length > 0 && ident.value[0] >= 'A' && ident.value[0] <= 'Z';
      // Struct instantiation? IDENT { ... } on same line
      if (startsUpper && this.peek().type === 'LBRACE' && this.peek().line === ident.line) {
        this.next(); // {
        this.skipNewlines();
        const fields = [];
        const seen = new Set();
        while (this.peek().type !== 'RBRACE' && !this.atEOF()) {
          const fn = this.peek();
          if (fn.type !== 'IDENT') {
            throw this.err(`Expected field name in ${ident.value} instantiation.`, fn);
          }
          if (seen.has(fn.value)) {
            throw this.err(`Duplicate field '${fn.value}'.`, fn);
          }
          seen.add(fn.value);
          this.next();
          const eq = this.peek();
          if (!(eq.type === 'OP' && eq.value === '=')) {
            throw this.err(`Expected '=' after field '${fn.value}'.`, eq);
          }
          this.next(); // =
          this.skipNewlines();
          const val = this.parseExpr();
          fields.push({ name: fn.value, value: val, token: fn });
          if (this.peek().type === 'COMMA') this.next();
          this.skipNewlines();
        }
        this.expect('RBRACE', '}');
        return n('StructInst', { structName: ident.value, structToken: ident, fields, token: ident });
      }
      return n('VarRef', { name: ident.value, token: ident });
    }

    throw this.err(`Unexpected ${this.describe(t)} in expression.`, t);
  }
}

function parse(tokens, lines, file) {
  const p = new Parser(tokens, lines, file);
  const prog = p.parseProgram();
  // Ensure EOF
  if (!p.atEOF()) {
    throw p.err(`Unexpected ${p.describe(p.peek())}.`, p.peek());
  }
  return prog;
}

module.exports = { Parser, parse };
