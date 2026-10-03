'use strict';

// Vexel 2.2 Avalonia backend — Vexel AST -> C# (.NET 8 + Avalonia 11).
// Implements the full Vexel 2.2 surface: multi-window, all widgets,
// containers, styling/themes, events with the `event`/`key` objects,
// animations, timers with handles, background tasks, HTTP, JSON, and the
// shared input/output buffer. Anything genuinely unsupported fails loudly
// (BackendError) instead of pretending to work. The compiler never names
// Avalonia controls; all UI work goes through the stable VexAx API in
// runtime/ui/backend/avalonia/VexAx.cs.

const path = require('path');
const { VexelError } = require('../diagnostics/diagnostics.js');

const AX_VERSION = '11.3.22';
const AX_TFM = 'net8.0';
const AX_PHASE = '2.2';

function axEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function sanitizeIdent(s) {
  return String(s).replace(/[^A-Za-z0-9_]/g, '_');
}

function buildPrefixes(order) {
  const map = new Map();
  order.forEach((absPath, idx) => {
    const base = path.basename(absPath, path.extname(absPath));
    map.set(path.normalize(absPath), `M${idx}_${sanitizeIdent(base)}`);
  });
  return map;
}

// Import alias -> defining module prefix (mirrors the WinForms backend).
function axModPrefixFor(prefixOf, curScope, moduleName) {
  const imp = (curScope.imports || []).find((im) => im.moduleName === moduleName);
  if (!imp) return null;
  return prefixOf(imp.absPath);
}

// Same-module global -> prefixed static field.
function axGref(ctx, name) {
  if (name === 'output') return `${ctx.prefix}_output`;
  return `${ctx.prefix}_${sanitizeIdent(name)}`;
}

// Resolve any variable read. Locals (params, hoisted body names,
// handler/task captures) stay `v_`; module globals use their
// prefixed static — same model as the WinForms backend.
function axVarRead(ctx, name, resolved) {
  if (name === 'window' && ctx.scope && ctx.scope.hasWindow) return 'VexAx.MainWindow';
  if (resolved && resolved.kind === 'window-ref') return 'VexAx.MainWindow';
  if (resolved && (resolved.kind === 'local' || resolved.kind === 'outer')) return `v_${sanitizeIdent(name)}`;
  if (resolved && resolved.kind === 'global') {
    if (resolved.module && ctx.scope && resolved.module !== ctx.scope.name) {
      const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, resolved.module) : null;
      if (p) return `${p}_${sanitizeIdent(name)}`;
    }
    return axGref(ctx, name);
  }
  // Fallback by scope knowledge.
  if (hasName(ctx, name)) return `v_${sanitizeIdent(name)}`;
  if (ctx.scope && ctx.scope.variables && ctx.scope.variables.has(name)) return axGref(ctx, name);
  return `v_${sanitizeIdent(name)}`;
}

// Emits `LHS = rhs;`, declaring `dynamic v_` only for true locals.
// Globals (prefixed statics, pre-declared per module) assign directly.
// `output` keeps legacy method-local behavior bit-for-bit.
function axEmitAssign(ctx, put, st, name, rhs) {
  if (name !== 'output' && st && st._targetKind === 'global') { put(`${axGref(ctx, name)} = ${rhs};`); return; }
  const nm = `v_${sanitizeIdent(name)}`;
  if (hasName(ctx, name)) put(`${nm} = ${rhs};`);
  else { ctx.declared.add(name); put(`dynamic ${nm} = ${rhs};`); }
}
// LHS expression without declaration (for AddTo after creation etc.).
function axLhs(ctx, st, name) {
  if (name !== 'output' && st && st._targetKind === 'global') return axGref(ctx, name);
  return `v_${sanitizeIdent(name)}`;
}
// Storage reference mirroring semantic lookupVar priority
// (locals -> outer -> module globals). Used where no _targetKind exists.
function axLvalue(ctx, name) {
  if (hasName(ctx, name)) return `v_${sanitizeIdent(name)}`;
  if (ctx.scope && ctx.scope.variables && ctx.scope.variables.has(name)) return axGref(ctx, name);
  return `v_${sanitizeIdent(name)}`;
}
// Hoist body-locals for a nested scope (handlers, timers, tasks,
// components). Skips handler implicits, remapped names, and captured
// outer locals. When skipGlobals is set (handlers, timers — whose
// bodies can bind module globals), names in scope.variables are left
// to their prefixed statics. Tasks and components always bind locals,
// so they declare everything (shadowing included).
// `sub` receives the declarations; `outer` is the enclosing ctx.
function axHoistInto(bodyStmts, sub, outer, lines, ind, extraSkip, skipGlobals) {
  for (const n of collectAXAssigns(bodyStmts)) {
    if (n === 'key' || n === 'event') continue;
    if (extraSkip && extraSkip.includes(n)) continue;
    if (hasName(outer, n)) continue;
    if (skipGlobals && outer && outer.scope && outer.scope.variables && outer.scope.variables.has(n)) continue;
    sub.declared.add(n);
    lines.push(`${ind}dynamic v_${sanitizeIdent(n)} = null;`);
  }
}

function axErr(message, st, modFile) {
  const token = (st && st.token) || null;
  throw new VexelError({
    type: 'BackendError',
    message: `${message} (Avalonia backend, ${AX_PHASE})`,
    file: modFile || '<unknown>',
    line: (token && token.line) || 1,
    column: (token && token.column) || 1,
  });
}

// (Property names are validated by semantic per widget kind; dynamic
// handles are re-checked at runtime by VexAx.SetProp, so no static list
// is needed here.)

function axCtx(outer) {
  const c = { declared: new Set(), outer: outer || null, inHandler: false, inKeyHandler: false, seq: 0, errName: 'v_error', inTask: false, remap: null, prefix: null, prefixOf: null, scope: null };
  if (outer) {
    c.prefix = outer.prefix;
    c.prefixOf = outer.prefixOf;
    c.scope = outer.scope;
  }
  return c;
}

// Vexel has function/handler scope (no block scope), but C# braces DO
// scope locals. Every name assigned anywhere in a scope is pre-declared
// (= null) at the top of that scope — same approach as the other backends.
// `key`/`event` are reserved for handler implicits and never hoisted.
function collectAXAssigns(stmts) {
  const names = new Set();
  const walk = (list) => {
    for (const st of list || []) {
      if (!st || typeof st !== 'object') continue;
      if (st.type === 'VarAssign' && st.target && st.target.type === 'VarRef' &&
          st.target.name !== 'key' && st.target.name !== 'event' && st.target.name !== 'window') {
        names.add(st.target.name);
      } else if (st.type === 'PublicDecl' && st.decl && st.decl.type === 'VarAssign' &&
          st.decl.target && st.decl.target.type === 'VarRef') {
        names.add(st.decl.target.name);
      } else if (st.type === 'TaskStmt') {
        // Handle only: the body gets its own scope pass at emission.
        names.add(st.name);
      } else if (st.type === 'SetOutputStmt' && st.dest && st.dest.type === 'VarRef') {
        names.add(st.dest.name);
      } else if (st.type === 'IfStmt') {
        for (const br of st.branches || []) walk(br.body);
        walk(st.elseBody);
      } else if (st.type === 'TryStmt') {
        walk(st.tryBody);
        walk(st.catchBody);
      } else if (st.type === 'RepeatCount' || st.type === 'RepeatTill') {
        walk(st.body);
      }
      // UIEventHandler bodies get their own pass.
    }
  };
  walk(stmts);
  return names;
}

function hasName(ctx, name) {
  if (!ctx) return false;
  if (ctx.declared && ctx.declared.has(name)) return true;
  let o = ctx.outer;
  while (o) {
    if (o.declared && o.declared.has(name)) return true;
    o = o.outer || null;
  }
  return false;
}

// ---------------- expressions ----------------

function genAXExpr(node, st, modFile, ctx) {
  if (!node) axErr('Missing value', st, modFile);
  switch (node.type) {
    case 'IntLit': return `${node.value}`;
    case 'FloatLit': return `(${node.value})`;
    case 'StrLit': return `"${axEscape(node.value)}"`;
    case 'BoolLit': return node.value ? 'true' : 'false';
    case 'NullLit': return 'null';
    case 'VarRef': {
      const r0 = node._resolved || {};
      // Vexel 2.2: bare zero-arg call (`hello`) and `paste` resolve here.
      if (r0.kind === 'func-call-zero') return `F_${ctx.prefix}_${sanitizeIdent(r0.name)}()`;
      if (r0.kind === 'paste') return 'VexAx.ClipboardGet()';
      // Vexel 2.9: program command-line arguments.
      if (r0.kind === 'args') return 'VexAx.Args()';
      if (r0.kind === 'window-ref' || node.name === 'window') {
        if (node.name === 'window' && !(ctx.scope && ctx.scope.hasWindow)) return `v_${sanitizeIdent(node.name)}`;
        return 'VexAx.MainWindow';
      }
      // UI targets carry their binding: windows resolve to the singleton,
      // globals to their prefixed static, locals stay `v_`.
      if (r0.kind === 'ui-target') {
        if (r0.binding === 'window') return 'VexAx.MainWindow';
        if (r0.binding === 'global') {
          if (r0.module && ctx.scope && r0.module !== ctx.scope.name) {
            const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, r0.module) : null;
            if (p) return `${p}_${sanitizeIdent(r0.name)}`;
          }
          return axGref(ctx, r0.name);
        }
        return `v_${sanitizeIdent(node.name)}`;
      }
      if (ctx.remap && ctx.remap[node.name]) return ctx.remap[node.name];
      if (node.name === 'key' && ctx.inKeyHandler) return 'v_key';
      if (node.name === 'event' && ctx.inHandler) return 'v_event';
      return axVarRead(ctx, node.name, r0);
    }
    case 'OutputRef': {
      // `output` is the shared input buffer, unless the program stored a
      // UI output box under that name (semantic tracks which mode).
      const ro = node._resolved || {};
      if (ro.kind === 'global') return `v_${sanitizeIdent(ro.name)}`;
      return 'VexAx.Output';
    }
    case 'ErrorRef': return ctx.errName || 'v_error';
    case 'BinaryExpr': {
      const L = genAXExpr(node.left, st, modFile, ctx);
      const R = genAXExpr(node.right, st, modFile, ctx);
      const op = node.op;
      if (op === '+') return `VexAx.Add((${L}), (${R}))`;
      if (op === '-') return `VexAx.Sub((${L}), (${R}))`;
      if (op === '*') return `VexAx.Mul((${L}), (${R}))`;
      if (op === '/') return `VexAx.Div((${L}), (${R}))`;
      if (op === '%') return `VexAx.Rem((${L}), (${R}))`;
      if (op === '=' || op === '==') return `VexAx.Eq((${L}), (${R}))`;
      if (op === '<>' || op === '!=') return `(!VexAx.Eq((${L}), (${R})))`;
      if (op === '<' || op === '>' || op === '<=' || op === '>=') {
        return `(VexAx.AsDouble((${L})) ${op} VexAx.AsDouble((${R})))`;
      }
      if (op === 'and') return `(VexAx.IsTrue((${L})) && VexAx.IsTrue((${R})))`;
      if (op === 'or') return `(VexAx.IsTrue((${L})) || VexAx.IsTrue((${R})))`;
      axErr(`Operator '${op}' is not supported by the Avalonia backend yet`, st || node, modFile);
      return 'null';
    }
    case 'UnaryExpr': {
      const E = genAXExpr(node.expr, st, modFile, ctx);
      if (node.op === 'not') return `(!VexAx.IsTrue((${E})))`;
      if (node.op === '-') return `(-VexAx.AsDouble((${E})))`;
      axErr(`Operator '${node.op}' is not supported by the Avalonia backend yet`, st || node, modFile);
      return 'null';
    }
    case 'FieldAccess': {
      const r = node._resolved || {};
      // Vexel 2.9: enum values are plain strings at runtime.
      if (r.kind === 'enum-lit') {
        return `"${axEscape(r.value)}"`;
      }
      if (node.object && node.object.type === 'EventRef') {
        return `VexAx.EvGet(v_event, "${node.field}")`;
      }
      if (node.object && node.object.type === 'ErrorRef') {
        return `VexAx.EvGet(${ctx.errName || 'v_error'}, "${node.field}")`;
      }
      if (r.kind === 'ui-prop') {
        const base = genAXExpr(node.object, st, modFile, ctx);
        return `VexAx.GetProp((${base}), "${node.field}")`;
      }
      // Cross-module global read (`logic.first`): prefixed static.
      if (r.kind === 'module-var') {
        const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, r.moduleName) : null;
        if (!p) axErr(`Unknown module '${r.moduleName}'`, st || node, modFile);
        return `${p}_${sanitizeIdent(node.field)}`;
      }
      if (r.kind === 'module-func-zero') {
        const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, r.moduleName) : null;
        if (!p) axErr(`Unknown module '${r.moduleName}'`, st || node, modFile);
        return `F_${p}_${sanitizeIdent(r.name)}()`;
      }
      // Vexel 2.2 phase 7: task handle facets + dynamic field reads
      // (HTTP responses, JSON objects) with runtime checking.
      if (r.kind === 'task-state') {
        return `VexAx.TaskState((${genAXExpr(node.object, st, modFile, ctx)}))`;
      }
      if (r.kind === 'task-result') {
        return `VexAx.TaskResult((${genAXExpr(node.object, st, modFile, ctx)}))`;
      }
      if (r.kind === 'task-error') {
        return `VexAx.TaskError((${genAXExpr(node.object, st, modFile, ctx)}))`;
      }
      if (r.kind === 'any-field') {
        return `VexAx.FieldGet((${genAXExpr(node.object, st, modFile, ctx)}), "${node.field}")`;
      }
      if (r.kind === 'task-cancel' || r.kind === 'timer-cancel') {
        axErr('task.cancel runs as a statement, not a value', st || node, modFile);
        return 'null';
      }
      if (r.kind === 'proc-kill') {
        axErr('process.kill runs as a statement, not a value', st || node, modFile);
        return 'null';
      }
      if (r.kind === 'model-member') {
        axErr(`Model members need a console program — models are console-only in v0.5.`, st || node, modFile);
        return 'null';
      }
      axErr(`This field access is not supported by the Avalonia backend yet`, st || node, modFile);
      return 'null';
    }
    case 'NumberOf': return `VexAx.AsDouble((${genAXExpr(node.expr, st, modFile, ctx)}))`;
    case 'CharAt':
      return `VexAx.CharAt((${genAXExpr(node.base, st, modFile, ctx)}), (${genAXExpr(node.index, st, modFile, ctx)}))`;
    case 'RandomExpr':
      return `VexAx.Rand((${genAXExpr(node.low, st, modFile, ctx)}), (${genAXExpr(node.high, st, modFile, ctx)}))`;
    case 'JsonRead': return `VexAx.JsonRead(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'RunExpr': return `VexAx.TermRunCapture(VexAx.Display((${genAXExpr(node.cmd, st, modFile, ctx)})))`;
    case 'FileRead': return `VexAx.FileRead(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'FileExists': return `VexAx.FileExists(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'DirExists': return `VexAx.DirExists(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'FileSize': return `VexAx.FileSize(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'DirList': return `VexAx.DirList(VexAx.Display((${genAXExpr(node.path, st, modFile, ctx)})))`;
    case 'HttpGet': return `VexAx.HttpGet((${genAXExpr(node.url, st, modFile, ctx)}))`;
    case 'HttpRequest': {
      const b = node.body ? `(${genAXExpr(node.body, st, modFile, ctx)})` : 'null';
      const h = node.headers ? `(${genAXExpr(node.headers, st, modFile, ctx)})` : 'null';
      return `VexAx.HttpRequest("${node.method.toUpperCase()}", (${genAXExpr(node.url, st, modFile, ctx)}), ${b}, ${h})`;
    }
    case 'AskExpr': return `VexAx.AskYesNo((${genAXExpr(node.prompt, st, modFile, ctx)}))`;
    case 'UIAddNode': {
      const r = node._resolved || {};
      const base = node.base ? `(${genAXExpr(node.base, st, modFile, ctx)})` : 'null';
      if (r.kind === 'ui-add-column') return `VexAx.TableColumn(${base}, ${node.value ? `(${genAXExpr(node.value, st, modFile, ctx)})` : '""'})`;
      if (r.kind === 'ui-add-row') return `VexAx.TableRow(${base}, ${node.value ? `(${genAXExpr(node.value, st, modFile, ctx)})` : 'null'})`;
      if (r.kind === 'ui-add-toolbar-button') {
        const title = node.widget && node.widget.title ? `(${genAXExpr(node.widget.title, st, modFile, ctx)})` : '""';
        return `VexAx.AddToolbarButton(${base}, ${title})`;
      }
      // Vexel 2.9: toolbar separators and labeled groups.
      if (r.kind === 'ui-add-separator') {
        return `VexAx.AddToolbarSeparator(${base})`;
      }
      if (r.kind === 'ui-add-group') {
        return `VexAx.AddToolbarGroup(${base}, ${node.value ? `(${genAXExpr(node.value, st, modFile, ctx)})` : '""'})`;
      }
      axErr('This table/toolbar add is not supported by the Avalonia backend yet', st || node, modFile);
      return 'null';
    }
    case 'CallExpr': {
      // Plain calls (ask, find, user functions) resolve on the NODE;
      // method-style calls (list add/remove, UI item ops) resolve on
      // the callee FieldAccess.
      const callee = node.callee;
      const r = (callee && callee._resolved) || {};
      const args = node.args.map((a) => `(${genAXExpr(a, st, modFile, ctx)})`);
      // Plain calls (ask, find, user functions) resolve on the NODE.
      const rn = node._resolved || {};
      if (rn.kind === 'ask-call') return `VexAx.AskYesNo(${args[0] || '""'})`;
      if (rn.kind === 'find-call') return `VexAx.FindById(${args[0] || '""'})`;
      // Vexel 3.0 Praxis dialogs.
      if (rn.kind === 'confirm-call') return `VexAx.Confirm(${args[0] || '""'})`;
      if (rn.kind === 'prompt-call') return `VexAx.Prompt(${args[0] || '""'})`;
      // Vexel 2.2.1: `p = process "exe", "args"...` launches async.
      if (rn.kind === 'proc-start') {
        if (args.length === 0) axErr('process needs a program', st || node, modFile);
        return `VexAx.ProcStart(${args.join(', ')})`;
      }
      if (rn.kind === 'func-call' || rn.kind === 'func-call-zero') {
        return `F_${ctx.prefix}_${sanitizeIdent(rn.name)}(${args.join(', ')})`;
      }
      if (rn.kind === 'module-func-call' || rn.kind === 'module-func-zero') {
        const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, rn.moduleName) : null;
        if (!p) axErr(`Unknown module '${rn.moduleName}'`, st || node, modFile);
        return `F_${p}_${sanitizeIdent(rn.name)}(${args.join(', ')})`;
      }
      const base = callee && callee.object ? `((${genAXExpr(callee.object, st, modFile, ctx)}))` : 'null';
      if (r.kind === 'list-add') return `VexAx.ListAdd(${base}, ${args[0] || 'null'})`;
      if (r.kind === 'list-remove') return `VexAx.ListRemove(${base}, ${args[0] || '0'})`;
      // Dynamic handles (`any`, e.g. json-read lists): same list ops,
      // resolved at runtime with clear errors.
      if (r.kind === 'any-addremove' || rn.kind === 'any-addremove') {
        const m = r.method || rn.method || '';
        if (m === 'add') return `VexAx.ListAdd(${base}, ${args[0] || 'null'})`;
        if (m === 'remove') return `VexAx.ListRemove(${base}, ${args[0] || '0'})`;
        axErr(`Cannot call '${m}' here`, st || node, modFile);
        return 'null';
      }
      if (r.kind === 'ui-add-item') return `VexAx.DropAdd(${base}, ${args[0] || '""'})`;
      if (r.kind === 'model-forward' || r.kind === 'model-member-call') {
        axErr('Model methods (forward/eval/train) need a console program — models are console-only in v0.5.', st || node, modFile);
        return 'null';
      }
      if (r.kind === 'ui-remove') return `VexAx.RemoveItem(${base}, ${args[0] || '0'})`;
      if (r.kind === 'ui-add-named') return `VexAx.AddChildItem(${base}, ${args[0] || '""'})`;
      if (r.kind === 'ui-add-column') return `VexAx.TableColumn(${base}, ${args[0] || '""'})`;
      if (r.kind === 'ui-add-row') return `VexAx.TableRow(${base}, ${args[0] || 'null'})`;
      if (r.kind === 'ui-add-toolbar-button') return `VexAx.AddToolbarButton(${base}, ${args[0] || '""'})`;
      axErr('This call is not supported by the Avalonia backend yet', st || node, modFile);
      return 'null';
    }
    case 'ListLit': {
      const items = (node.elements || []).map((e) => `(${genAXExpr(e, st, modFile, ctx)})`);
      return `VexAx.NewList(${items.join(', ')})`;
    }
    case 'IndexAccess': {
      const base = genAXExpr(node.object, st, modFile, ctx);
      const idx = genAXExpr(node.index, st, modFile, ctx);
      return `VexAx.IdxGet((${base}), (${idx}))`;
    }
    case 'LengthOf': return `VexAx.Len((${genAXExpr(node.expr, st, modFile, ctx)}))`;
    case 'StructInst': {
      const fields = (node.fields || []).map((f) => `{ "${sanitizeIdent(f.name)}", (${genAXExpr(f.value, st, modFile, ctx)}) }`);
      return `VexAx.StructNew("${sanitizeIdent(node.structName || '')}", new Dictionary<string, object> { ${fields.join(', ')} })`;
    }
    case 'ObjectLit': {
      const fields = (node.fields || []).map((f) => `{ "${sanitizeIdent(f.name)}", (${genAXExpr(f.value, st, modFile, ctx)}) }`);
      return `VexAx.StructNew("", new Dictionary<string, object> { ${fields.join(', ')} })`;
    }
    case 'PercentOf': {
      const base = genAXExpr(node.base, st, modFile, ctx);
      return `VexAx.PercentNow((${base}), (${genAXExpr(node.value, st, modFile, ctx)}))`;
    }
    case 'ChooseFile': return 'VexAx.PickFile()';
    case 'ChooseFolder': return 'VexAx.PickFolder()';
    case 'ChooseColor': return 'VexAx.PickColor()';
    case 'EventRef': return 'v_event';
    case 'GpuInfo':
      axErr('GPU info (gpu available/count/name) needs a console program — GPU features are console-only in v0.4.', st || node, modFile);
      return 'null';
    case 'LoadModelExpr':
      axErr('load model needs a console program — model loading is console-only in v0.5.', st || node, modFile);
      return 'null';
    case 'CreateModelExpr':
      axErr('create model needs a console program — models are console-only in v0.5.', st || node, modFile);
      return 'null';
    case 'ModelInfoExpr':
      axErr('model info needs a console program — models are console-only in v0.5.', st || node, modFile);
      return 'null';
    default:
      axErr(`'${node.type}' is not supported by the Avalonia backend yet`, st || node, modFile);
      return 'null';
  }
}

// ---------------- statements ----------------

function emitAXAssignTarget(target, val, st, modFile, lines, ctx, ind) {
  if (target.type === 'VarRef') {
    // Vexel 2.2 phase 7: `result` inside a task body writes the task box.
    if (ctx.remap && ctx.remap[target.name]) {
      lines.push(`${ind}${ctx.remap[target.name]} = (${val});`);
      return;
    }
    axEmitAssign(ctx, (s) => lines.push(ind + s), st, target.name, `(${val})`);
    return;
  }
  axErr('This assignment is not supported by the Avalonia backend yet', st, modFile);
}

const AX_WIDGETS = {
  button: (t) => `VexAx.NewButton(${t})`,
  text: (t) => `VexAx.NewLabel(${t})`,
  input: (t) => `VexAx.NewInput(${t})`,
  output: (t) => `VexAx.NewOutput(${t})`,
  checkbox: (t) => `VexAx.NewCheckbox(${t})`,
  slider: () => 'VexAx.NewSlider()',
  progress: () => 'VexAx.NewProgress(false)',
  spinner: () => 'VexAx.NewProgress(true)',
  dropdown: () => 'VexAx.NewDropdown()',
  listbox: () => 'VexAx.NewListbox()',
  image: (t, st, modFile, src) => `VexAx.NewImage(${src})`,
  // Vexel 2.2 parity: menu, tab bar and tree create real controls.
  // Toolbar = horizontal strip of real buttons; tables are core-control
  // grids (no extra packages needed).
  menu: (t) => `VexAx.NewMenu(${t})`,
  tabbar: () => 'VexAx.NewTabbar()',
  tree: () => 'VexAx.NewTree()',
  toolbar: () => 'VexAx.NewToolbar()',
  table: () => 'VexAx.NewTable()',
  // Vexel 3.0 Praxis controls.
  switch: (t) => `VexAx.NewSwitch(${t})`,
  radio: (t) => `VexAx.NewRadio(${t})`,
  numeric: () => 'VexAx.NewNumeric()',
  search: (t) => `VexAx.NewSearch(${t})`,
  card: (t) => `VexAx.NewCard(${t})`,
  statusbar: (t) => `VexAx.NewStatusbar(${t})`,
  separator: () => 'VexAx.NewSeparator()',
  contextmenu: () => 'VexAx.NewContextMenu()',
};

// Builds a widget creation expression plus its parent. Used by both the
// assignment form (`b = add a button ...`) and the bare statement form.
function genAXWidget(val, st, modFile, ctx) {
  // `add a panel/form/scroll area` arrives as a widget-form container.
  if (val.kind === 'container') {
    const lay = val.layout || 'plain';
    const made = lay === 'plain' ? 'VexAx.NewPanel()'
      : lay === 'scroll' ? 'VexAx.NewScroll()'
      : null;
    if (!made) axErr(`Container '${lay}' is not supported by the Avalonia backend yet`, st, modFile);
    const cparent = val.to ? `(${genAXExpr(val.to, st, modFile, ctx)})` : 'VexAx.CurrentRoot()';
    return { expr: made, parent: cparent };
  }
  const maker = AX_WIDGETS[val.kind];
  if (!maker) axErr(`Widget '${val.kind}' is not supported by the Avalonia backend yet`, st, modFile);
  const title = val.title ? genAXExpr(val.title, st, modFile, ctx) : '""';
  let src = '""';
  if (val.kind === 'image') src = val.source ? genAXExpr(val.source, st, modFile, ctx) : '""';
  const parent = val.to ? `(${genAXExpr(val.to, st, modFile, ctx)})` : 'VexAx.CurrentRoot()';
  return { expr: maker(title, st, modFile, src), parent };
}

function genAXContainer(val, st, modFile, ctx) {
  const lay = val.layout || 'plain';
  const made = lay === 'plain' ? 'VexAx.NewPanel()'
    : lay === 'horizontal' ? 'VexAx.NewStack(true)'
    : lay === 'vertical' ? 'VexAx.NewStack(false)'
    : lay === 'grid' ? 'VexAx.NewGrid()'
    : lay === 'scroll' ? 'VexAx.NewScroll()'
    : null;
  if (!made) axErr(`Container '${lay}' is not supported by the Avalonia backend yet`, st, modFile);
  const parent = val.to ? `(${genAXExpr(val.to, st, modFile, ctx)})` : 'VexAx.CurrentRoot()';
  return { expr: made, parent };
}

function emitAXStatement(st, modFile, lines, ctx, ind) {
  if (!st) return;
  const put = (s) => lines.push(ind + s);
  switch (st.type) {
    case 'CreateWindow': {
      const t = st.title ? genAXExpr(st.title, st, modFile, ctx) : '"Vexel App"';
      put(`VexAx.NewWindow(${t});`);
      return;
    }
    case 'VarAssign': {
      const target = st.target;
      const val = st.value;
      // `output = <widget/container/window/timer>` stores a UI object
      // under that name; any other value writes the shared input buffer.
      const isOutputTarget = target && target.type === 'OutputRef';
      const name = isOutputTarget ? 'output'
        : (target && target.type === 'VarRef' ? target.name : null);
      if (val && val.type === 'CreateWindow' && val.handle) {
        if (!name) axErr('A window handle needs a plain variable', st, modFile);
        const t = val.title ? genAXExpr(val.title, st, modFile, ctx) : '"Vexel App"';
        axEmitAssign(ctx, put, st, name, `VexAx.NewWindow(${t})`);
        return;
      }
      if (val && val.type === 'AddWidget') {
        if (!name) axErr('Widgets need a variable name', st, modFile);
        const w = genAXWidget(val, st, modFile, ctx);
        // Parenting is explicit at runtime: latest window by default,
        // or the `to` target (windows and containers).
        axEmitAssign(ctx, put, st, name, w.expr);
        put(`VexAx.AddTo(${w.parent}, ${axLhs(ctx, st, name)});`);
        return;
      }
      if (val && val.type === 'CreateContainer') {
        // Vexel 2.2 phase 5: explicit layout containers. The container
        // itself parents to the latest window (or `to`, if ever present).
        if (!name) axErr('Containers need a variable name', st, modFile);
        const c = genAXContainer(val, st, modFile, ctx);
        axEmitAssign(ctx, put, st, name, c.expr);
        put(`VexAx.AddTo(${c.parent}, ${axLhs(ctx, st, name)});`);
        return;
      }
      if (isOutputTarget) {
        put(`VexAx.Output = (${genAXExpr(val, st, modFile, ctx)});`);
        return;
      }
      if (target && target.type === 'FieldAccess' && target.object) {
        const r = target._resolved || {};
        // Cross-module assign (`logic.x = ...`): defining module's static.
        if (r.kind === 'module-var') {
          const p = ctx.prefixOf ? axModPrefixFor(ctx.prefixOf, ctx.scope, r.moduleName) : null;
          if (!p) axErr(`Unknown module '${r.moduleName}'`, st, modFile);
          put(`${p}_${sanitizeIdent(target.field)} = (${genAXExpr(val, st, modFile, ctx)});`);
          return;
        }
        if (r.kind === 'ui-prop') {
          // Semantic already validated the prop for this widget kind;
          // dynamic handles are checked at runtime.
          const base = genAXExpr(target.object, st, modFile, ctx);
          put(`VexAx.SetProp(${base}, "${target.field}", (${genAXExpr(val, st, modFile, ctx)}));`);
          return;
        }
        if (r.kind === 'ui-style') {
          const base = genAXExpr(target.object, st, modFile, ctx);
          put(`VexAx.ApplyStyle(${base}, (${genAXExpr(val, st, modFile, ctx)}));`);
          return;
        }
        if (r.kind === 'struct-field' || r.kind === 'any-field') {
          const base = genAXExpr(target.object, st, modFile, ctx);
          put(`VexAx.FieldSet(${base}, "${target.field}", (${genAXExpr(val, st, modFile, ctx)}));`);
          return;
        }
        axErr('This assignment is not supported by the Avalonia backend yet', st, modFile);
        return;
      }
      if (target && target.type === 'IndexAccess') {
        const base = genAXExpr(target.object, st, modFile, ctx);
        const idx = genAXExpr(target.index, st, modFile, ctx);
        put(`VexAx.IdxSet((${base}), (${idx}), (${genAXExpr(val, st, modFile, ctx)}));`);
        return;
      }
      if (val && val.type === 'TimerStmt') {
        // Vexel 2.2 phase 4: `ticker = every 1 second { ... }` creates a
        // cancellable VexTimer handle (semantic declares the variable).
        if (!val.handle) axErr('Timers need a variable (e.g. ticker = every 1 second { ... })', st, modFile);
        {
          const start = genAXTimerStart(val, ctx, modFile, ind);
          axEmitAssign(ctx, put, st, target.name, start);
        }
        return;
      }
      emitAXAssignTarget(target, genAXExpr(val, st, modFile, ctx), st, modFile, lines, ctx, ind);
      return;
    }
    case 'TimerStmt': {
      // Bare `every/after` blocks are fire-and-forget (result discarded).
      const start = genAXTimerStart(st, ctx, modFile, ind);
      put(`${start};`);
      return;
    }
    case 'TaskStmt': {
      // Vexel 2.2 phase 7: `task name { ... }` runs the body on a worker
      // thread and binds a VexTask handle. `result` inside writes a box
      // the handle reads back (locked); nothing else escapes the scope.
      // Body locals hoist INSIDE the delegate (separate array), so two
      // tasks can use the same variable names without colliding.
      const box = `v_${sanitizeIdent(st.name)}__result`;
      ctx.declared.add(box);
      put(`dynamic ${box} = null;`);
      const sub = axCtx(ctx);
      sub.inTask = true;
      sub.remap = { result: box };
      const tbody = [];
      axHoistInto(st.body, sub, ctx, tbody, ind + '        ', ['result'], false);
      const hn = axLhs(ctx, st, st.name);
      if (!hasName(ctx, st.name) && !(st && st._targetKind === 'global')) ctx.declared.add(st.name);
      put(`${hn} = VexAx.TaskRun((Action)(delegate() {`);
      for (const tl of tbody) lines.push(tl);
      for (const inner of st.body) emitAXStatement(inner, modFile, lines, sub, ind + '        ');
      put(`${ind}}), (Func<dynamic>)(delegate() { return ${box}; }));`);
      return;
    }
    case 'AddToContainer': {
      // Vexel 2.2 phase 5: `add X to Y` re-parents (runtime detaches first).
      const v = genAXExpr(st.value, st, modFile, ctx);
      const dst = genAXExpr(st.target, st, modFile, ctx);
      put(`VexAx.AddTo((${dst}), (${v}));`);
      return;
    }
    case 'UIAnimate': {
      // Vexel 2.2 phase 6: move/size/fade over a duration, non-blocking.
      // Bare `fade X duration T` (no `to`) fades IN: start transparent,
      // end opaque. Explicit `fade to V` keeps its target.
      const t = genAXExpr(st.target, st, modFile, ctx);
      let tx = 'null', ty = 'null', tw = 'null', th = 'null', top = 'null', secs = '1.0';
      let fadeIn = false;
      // Vexel 3.0 Praxis easing (linear default keeps 2.x behavior).
      let ease = '"linear"';
      for (const s of st.steps || []) {
        if (s.op === 'move-x') tx = `(object)VexAx.AsDouble((${genAXExpr(s.value, st, modFile, ctx)}))`;
        else if (s.op === 'move-y') ty = `(object)VexAx.AsDouble((${genAXExpr(s.value, st, modFile, ctx)}))`;
        else if (s.op === 'ease') ease = `"${s.value}"`;
        else if (s.op === 'fade-to') {
          if (s.value) top = `(object)VexAx.AsDouble((${genAXExpr(s.value, st, modFile, ctx)}))`;
          else { top = '(object)1.0'; fadeIn = true; }
        }
        else if (s.op === 'size') {
          tw = `(object)VexAx.AsDouble((${genAXExpr(s.w, st, modFile, ctx)}))`;
          th = `(object)VexAx.AsDouble((${genAXExpr(s.h, st, modFile, ctx)}))`;
        } else if (s.op === 'duration') secs = `VexAx.AsDouble((${genAXExpr(s.value, st, modFile, ctx)}))`;
      }
      if (fadeIn) put(`VexAx.SetProp((${t}), "opacity", 0);`);
      put(`VexAx.AnimateEase((${t}), ${tx}, ${ty}, ${tw}, ${th}, ${top}, ${secs}, ${ease});`);
      return;
    }
    case 'UISetProp': {
      if (!st.target || st.target.type !== 'VarRef') axErr('This setting is not supported by the Avalonia backend yet', st, modFile);
      const base = genAXExpr(st.target, st, modFile, ctx);
      // `set button width to 50 percent` / `set button height to fill`
      // track the parent at runtime; plain props go through SetProp.
      if (st.unit === 'percent') { put(`VexAx.SetPercent((${base}), "${st.prop}", (${genAXExpr(st.value, st, modFile, ctx)}));`); return; }
      if (st.unit === 'fill') { put(`VexAx.SetFill((${base}), "${st.prop}");`); return; }
      put(`VexAx.SetProp(${base}, "${st.prop}", (${genAXExpr(st.value, st, modFile, ctx)}));`);
      return;
    }
    case 'UISetPosition': {
      if (!st.target || st.target.type !== 'VarRef') axErr('This setting is not supported by the Avalonia backend yet', st, modFile);
      const base = genAXExpr(st.target, st, modFile, ctx);
      put(`VexAx.SetProp(${base}, "x", ${genAXExpr(st.x, st, modFile, ctx)});`);
      put(`VexAx.SetProp(${base}, "y", ${genAXExpr(st.y, st, modFile, ctx)});`);
      return;
    }
    case 'PrintStmt': {
      if (st.isFile) put(`VexAx.PrintFile(${JSON.stringify(st.filePath)});`);
      else put(`Console.WriteLine(VexAx.Display((${genAXExpr(st.arg, st, modFile, ctx)})));`);
      return;
    }
    case 'JsonWriteStmt': {
      put(`VexAx.JsonWrite((${genAXExpr(st.value, st, modFile, ctx)}), VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'TerminalStmt': {
      // Vexel 2.9: persistent shell session; cd/run only (parser-checked).
      put('{');
      for (const inner of st.body) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
      put('}');
      return;
    }
    case 'CdStmt': {
      put(`VexAx.TermCd(VexAx.Display((${genAXExpr(st.dir, st, modFile, ctx)})));`);
      return;
    }
    case 'RunStmt': {
      put(`VexAx.TermRun(VexAx.Display((${genAXExpr(st.cmd, st, modFile, ctx)})));`);
      return;
    }
    case 'FileWriteStmt': {
      put(`VexAx.FileWrite(VexAx.Display((${genAXExpr(st.value, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'FileAppendStmt': {
      put(`VexAx.FileAppend(VexAx.Display((${genAXExpr(st.value, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'FileDeleteStmt': {
      put(`VexAx.FileDelete(VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'FileCopyStmt': {
      put(`VexAx.FileCopy(VexAx.Display((${genAXExpr(st.from, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.to, st, modFile, ctx)})));`);
      return;
    }
    case 'FileMoveStmt': {
      put(`VexAx.FileMove(VexAx.Display((${genAXExpr(st.from, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.to, st, modFile, ctx)})));`);
      return;
    }
    case 'DirCreateStmt': {
      put(`VexAx.DirCreate(VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'DirDeleteStmt': {
      put(`VexAx.DirDelete(VexAx.Display((${genAXExpr(st.path, st, modFile, ctx)})));`);
      return;
    }
    case 'DirCopyStmt': {
      put(`VexAx.DirCopy(VexAx.Display((${genAXExpr(st.from, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.to, st, modFile, ctx)})));`);
      return;
    }
    case 'DirMoveStmt': {
      put(`VexAx.DirMove(VexAx.Display((${genAXExpr(st.from, st, modFile, ctx)})), VexAx.Display((${genAXExpr(st.to, st, modFile, ctx)})));`);
      return;
    }
    case 'IfStmt': {
      st.branches.forEach((br, idx) => {
        const kw = idx === 0 ? 'if' : 'else if';
        put(`${kw} (VexAx.IsTrue((${genAXExpr(br.cond, st, modFile, ctx)}))) {`);
        for (const inner of br.body) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
        put('}');
      });
      if (st.elseBody) {
        put('else {');
        for (const inner of st.elseBody) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
        put('}');
      }
      return;
    }
    case 'MatchStmt': {
      // Vexel 2.9: match desugars to an Eq chain (subject evaluated once).
      const n = ctx.seq++;
      put(`{ dynamic __vex_m${n} = (${genAXExpr(st.subject, st, modFile, ctx)});`);
      st.arms.forEach((arm, idx) => {
        const p = arm.pattern;
        const kw = idx === 0 ? 'if' : 'else if';
        if (p.type === 'MatchDefault') {
          put(`${idx === 0 ? 'if (true)' : 'else'} {`);
        } else {
          let test = 'null';
          if (p.type === 'MatchLit') {
            if (p.litType === 'STRING') test = `"${axEscape(p.value)}"`;
            else if (p.litType === 'BOOL') test = p.value ? 'true' : 'false';
            else if (p.litType === 'DECIMAL') test = `((double)${p.value})`;
            else test = `((long)${p.value})`;
          } else if (p.type === 'MatchNull') {
            test = 'null';
          } else if (p.type === 'MatchEnum') {
            test = `"${axEscape(p.value)}"`;
          }
          put(`${kw} (VexAx.Eq(__vex_m${n}, ${test})) {`);
        }
        for (const inner of arm.body) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
        put('}');
      });
      put('}');
      return;
    }
    case 'RepeatCount': {
      const n = ctx.seq++;
      put(`{ long __vex_cnt${n} = VexAx.AsInt(VexAx.AsDouble((${genAXExpr(st.count, st, modFile, ctx)})));`);
      put(`for (long __vex_i${n} = 0; __vex_i${n} < __vex_cnt${n}; __vex_i${n}++) {`);
      // Vexel 2.2 phase 7: cooperative cancellation checkpoints in tasks.
      if (ctx.inTask) put(`${ind}    VexAx.ThrowIfCancelled();`);
      for (const inner of st.body) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
      put('} }');
      return;
    }
    case 'RepeatTill': {
      put(`while (!VexAx.IsTrue((${genAXExpr(st.cond, st, modFile, ctx)}))) {`);
      if (ctx.inTask) put(`${ind}    VexAx.ThrowIfCancelled();`);
      for (const inner of st.body) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
      put('}');
      return;
    }
    case 'TryStmt': {
      const n = ctx.seq++;
      const prevErr = ctx.errName;
      ctx.errName = `v_error${n}`;
      put('try {');
      for (const inner of st.tryBody) emitAXStatement(inner, modFile, lines, ctx, ind + '    ');
      put(`} catch (Exception __vex_ex${n}) {`);
      put(`    dynamic ${ctx.errName} = VexAx.MakeError(__vex_ex${n});`);
      const sub = axCtx(ctx);
      sub.inHandler = ctx.inHandler;
      sub.inKeyHandler = ctx.inKeyHandler;
      sub.errName = ctx.errName;
      for (const inner of st.catchBody) emitAXStatement(inner, modFile, lines, sub, ind + '    ');
      put('}');
      ctx.errName = prevErr;
      return;
    }
    case 'RaiseStmt': {
      put(`throw new VexAxErr(VexAx.Display((${genAXExpr(st.value, st, modFile, ctx)})));`);
      return;
    }
    case 'WaitStmt': {
      const n = ctx.seq++;
      put(`{ double __vex_wait${n} = VexAx.AsDouble((${genAXExpr(st.value, st, modFile, ctx)}));`);
      // Vexel 2.2 phase 7: cancellable inside tasks, plain sleep elsewhere.
      put(`VexAx.WaitSeconds(__vex_wait${n}); }`);
      return;
    }
    case 'WaitTaskStmt': {
      // Vexel 2.9: blocking on a task handle would freeze the UI thread.
      axErr(`wait on a task handle is console-only. Poll ${st.handle && st.handle.name ? st.handle.name : 'the task'}.state from a timer instead`, st, modFile);
      return;
    }
    case 'HttpTimeoutStmt': {
      put(`VexAx.HttpSetTimeout((${genAXExpr(st.secs, st, modFile, ctx)}));`);
      return;
    }
    case 'MakeStmt': {
      if (!st.target) axErr('This conversion is not supported by the Avalonia backend yet', st, modFile);
      // Vexel 3.5 Atlas: gradient tracking is console-only (tensors
      // themselves already fail loudly in UI programs).
      if (st.mode === 'require-gradients') axErr(`Gradient tracking needs a console program. Atlas tensors are console-only in v0.1.`, st, modFile);
      // Same storage as a read: locals (incl. captures) stay `v_`,
      // module globals use their prefixed static.
      const nm = (ctx.remap && ctx.remap[st.target]) ? ctx.remap[st.target]
        : st.target === 'output' ? `v_${sanitizeIdent(st.target)}`
        : axLvalue(ctx, st.target);
      const mode = st.mode === 'number' ? 'VexAx.AsDouble'
        : st.mode === 'string' ? 'VexAx.Display'
        : st.mode === 'boolean' ? 'VexAx.AsBool'
        : st.mode === 'upper' ? 'VexAx.Display' : 'VexAx.Display';
      if (st.mode === 'upper') { put(`${nm} = VexAx.Display(${nm}).ToUpperInvariant();`); return; }
      if (st.mode === 'lower') { put(`${nm} = VexAx.Display(${nm}).ToLowerInvariant();`); return; }
      put(`${nm} = ${mode}(${nm});`);
      return;
    }
    case 'ExprStmt': {
      emitAXExprStmt(st.expr, st, modFile, lines, ctx, ind);
      return;
    }
    case 'UIEventHandler': {
      emitAXEvent(st, modFile, lines, ctx, ind);
      return;
    }
    case 'PublicDecl': {
      if (st.decl) { emitAXStatement(st.decl, modFile, lines, ctx, ind); return; }
      return;
    }
    // ---------- Vexel 2.2 parity: the remaining 2.0 surface ----------
    case 'ReturnStmt': {
      put(`return ${st.value ? `(${genAXExpr(st.value, st, modFile, ctx)})` : 'null'};`);
      return;
    }
    case 'InputStmt': {
      const prompt = st.prompt ? genAXExpr(st.prompt, st, modFile, ctx) : '""';
      put(`VexAx.Output = VexAx.AskInput(${prompt});`);
      return;
    }
    case 'SetOutputStmt': {
      if (!st.dest || st.dest.type !== 'VarRef') axErr('set output = needs a variable name', st, modFile);
      // dest was declared by semantic as a local (capture/hoist it) or a
      // module global (prefixed static); mirror that split here.
      const name = st.dest.name;
      if (!hasName(ctx, name) && ctx.scope && ctx.scope.variables && ctx.scope.variables.has(name)) {
        put(`${axGref(ctx, name)} = VexAx.Output;`);
        return;
      }
      emitAXAssignTarget(st.dest, 'VexAx.Output', st, modFile, lines, ctx, ind);
      return;
    }
    case 'RemoveStmt': {
      put(`VexAx.RemoveIt((${genAXExpr(st.target, st, modFile, ctx)}));`);
      return;
    }
    case 'ComponentUse': {
      put(`C_${ctx.prefix}_${sanitizeIdent(st.name)}();`);
      return;
    }
    case 'UICenter': {
      const base = genAXExpr(st.target, st, modFile, ctx);
      const inT = st.inTarget ? `(${genAXExpr(st.inTarget, st, modFile, ctx)})` : 'null';
      put(`VexAx.CenterIn((${base}), ${inT});`);
      return;
    }
    case 'UISetMinMax': {
      const base = genAXExpr(st.target, st, modFile, ctx);
      put(`VexAx.SetMinMax((${base}), "${st.which}", "${st.dim}", (${genAXExpr(st.value, st, modFile, ctx)}));`);
      return;
    }
    case 'UIUseTheme': {
      // `set theme to "dark"` / `use theme "Mono"` / `set theme to Mono`.
      // Semantic marks a bare declared-theme reference with _themeRef.
      let nm;
      if (st._themeRef) nm = `v_${sanitizeIdent(st._themeRef)}`;
      else if (st.name && st.name.type === 'StrLit') nm = `"${axEscape(st.name.value)}"`;
      else nm = `VexAx.Display((${genAXExpr(st.name, st, modFile, ctx)}))`;
      put(`VexAx.ApplyThemeByName(VexAx.MainWindow, ${nm});`);
      return;
    }
    case 'UIShowDialog': {
      const v = st.value ? genAXExpr(st.value, st, modFile, ctx) : '""';
      if (st.kind === 'warning') put(`VexAx.ShowWarn((${v}));`);
      else if (st.kind === 'confirmation') put(`VexAx.AskYesNo((${v}));`);
      else if (st.kind === 'input') put(`VexAx.Prompt((${v}));`);
      else put(`VexAx.ShowMsg((${v}));`);
      return;
    }
    case 'ShowNotification': {
      // Vexel 3.0 Praxis: show notification [kind] "text" [for N seconds].
      const v = genAXExpr(st.value, st, modFile, ctx);
      const secs = st.secs ? st.secs.value : '3.5';
      put(`VexAx.Notify("${st.kind}", (${v}), ${secs});`);
      return;
    }
    case 'CopyStmt': {
      put(`VexAx.ClipboardSet((${genAXExpr(st.value, st, modFile, ctx)}));`);
      return;
    }
    case 'StyleDecl': {
      const fields = (st.fields || []).map((f) => `{ "${sanitizeIdent(f.name)}", (${genAXExpr(f.value, st, modFile, ctx)}) }`);
      const nm = `v_${sanitizeIdent(st.name)}`;
      const made = `VexAx.MakeStyle(new Dictionary<string, object> { ${fields.join(', ')} })`;
      if (hasName(ctx, st.name)) put(`${nm} = ${made};`);
      else { ctx.declared.add(st.name); put(`dynamic ${nm} = ${made};`); }
      return;
    }
    case 'ThemeDecl': {
      const fields = (st.fields || []).map((f) => `{ "${sanitizeIdent(f.name)}", (${genAXExpr(f.value, st, modFile, ctx)}) }`);
      const nm = `v_${sanitizeIdent(st.name)}`;
      const made = `VexAx.MakeTheme(new Dictionary<string, object> { ${fields.join(', ')} })`;
      if (hasName(ctx, st.name)) put(`${nm} = ${made};`);
      else { ctx.declared.add(st.name); put(`dynamic ${nm} = ${made};`); }
      return;
    }
    case 'FuncDecl':
    case 'ComponentDecl':
    case 'StructDecl':
    case 'EnumDecl':
    case 'TestBlock':
      // Functions and components become methods on VexProgram (collected
      // by generateAX); structs, enums and tests need no inline code.
      return;
    case 'AssertStmt': {
      // Vexel 2.9: runtime boolean check; failures name file and line.
      const base = modFile ? modFile.split(/[\\/]/).pop() : 'main.vxl';
      const line = (st.token && st.token.line) || 1;
      put(`if (!VexAx.IsTrue((${genAXExpr(st.cond, st, modFile, ctx)}))) throw new VexAxErr("Assertion failed (${base} line ${line}).");`);
      return;
    }
    case 'MoveStmt':
      axErr('move ... to gpu needs a console program — GPU tensors are console-only in v0.4.', st, modFile);
      return;
    case 'SaveModelStmt':
      axErr('save model needs a console program — models are console-only in v0.5.', st, modFile);
      return;
    case 'InferenceStmt':
      axErr('with inference needs a console program — models are console-only in v0.5.', st, modFile);
      return;
    default:
      axErr(`'${st.type}' is not supported by the Avalonia backend yet`, st, modFile);
  }
}

// Vexel 2.2 phase 4: builds the VexAx.TimerStart(...) expression.
// The timed body runs as an Action delegate on the UI thread.
function genAXTimerStart(st, ctx, modFile, ind) {
  const v = genAXExpr(st.value, st, modFile, ctx);
  const once = st.once ? 'true' : 'false';
  const sub = axCtx(ctx);
  sub.inHandler = true;
  const lines = [];
  lines.push(`${ind}            double __vex_tiv = VexAx.AsDouble((${v}));`);
  lines.push(`${ind}            return VexAx.TimerStart(__vex_tiv, ${once}, delegate() {`);
  const hoist = [];
  axHoistInto(st.body, sub, ctx, hoist, ind + '                ', [], true);
  for (const h of hoist) lines.push(h);
  for (const inner of st.body) emitAXStatement(inner, modFile, lines, sub, ind + '                ');
  lines.push(`${ind}            });`);
  return `((Func<dynamic>)(() => {\n${lines.join('\n')}\n${ind}        }))()`;
}

function emitAXExprStmt(e, st, modFile, lines, ctx, ind) {
  const put = (s) => lines.push(ind + s);
  if (!e) return;
  if (e.type === 'FieldAccess' && e._resolved) {
    const r = e._resolved;
    // `window.show` / `name.show` present that window. The app lifetime
    // shows every presented window and exits with the last one.
    if (r.kind === 'ui-method' && r.method === 'show' && r.uiKind === 'window') {
      const base = genAXExpr(e.object, st, modFile, ctx);
      put(`VexAx.ShowWin((${base}));`);
      return;
    }
    if (r.kind === 'ui-method' || r.kind === 'ui-method-any') {
      const base = genAXExpr(e.object, st, modFile, ctx);
      put(`VexAx.DoMethod((${base}), "${r.method}");`);
      return;
    }
    // Vexel 2.2 phase 4: `ticker.cancel` stops a timer handle.
    if (r.kind === 'timer-cancel') {
      const base = genAXExpr(e.object, st, modFile, ctx);
      put(`VexAx.TimerCancel((${base}));`);
      return;
    }
    // Vexel 2.2 phase 7: `worker.cancel` cancels a task handle.
    if (r.kind === 'task-cancel') {
      const base = genAXExpr(e.object, st, modFile, ctx);
      put(`VexAx.TaskCancel((${base}));`);
      return;
    }
    // Vexel 2.2.1: `p.kill` stops a process handle.
    if (r.kind === 'proc-kill') {
      const base = genAXExpr(e.object, st, modFile, ctx);
      put(`VexAx.ProcKill((${base}));`);
      return;
    }
  }
  if (e.type === 'CallExpr' && e.callee && e.callee.type === 'FieldAccess' &&
      e.callee._resolved && e.callee._resolved.kind === 'ui-add-item') {
    const base = genAXExpr(e.callee.object, st, modFile, ctx);
    const arg = e.args.length > 0 ? genAXExpr(e.args[0], st, modFile, ctx) : '""';
    put(`VexAx.DropAdd((${base}), (${arg}));`);
    return;
  }
  // Bare `add a button titled "Go"` (no variable) creates and parents.
  if (e.type === 'AddWidget') {
    const w = genAXWidget(e, st, modFile, ctx);
    put(`VexAx.AddTo(${w.parent}, ${w.expr});`);
    return;
  }
  // `table.add column/row ...` and `toolbar.add ...` run for effect.
  if (e.type === 'UIAddNode') {
    put(`${genAXExpr(e, st, modFile, ctx)};`);
    return;
  }
  // Any other call (`items.remove 0`, `names.add "x"`, `ask "..."`,
  // user functions) runs for effect via the expression emitter, which
  // resolves each kind and stays loud on unknown ones.
  if (e.type === 'CallExpr') {
    put(`${genAXExpr(e, st, modFile, ctx)};`);
    return;
  }
  if (e.type === 'CreateContainer') {
    const c = genAXContainer(e, st, modFile, ctx);
    put(`VexAx.AddTo(${c.parent}, ${c.expr});`);
    return;
  }
  if (e.type === 'IntLit' || e.type === 'FloatLit' || e.type === 'StrLit' ||
      e.type === 'BoolLit' || e.type === 'VarRef' || e.type === 'OutputRef' || e.type === 'ErrorRef') {
    put(`VexAx.Display((${genAXExpr(e, st, modFile, ctx)}));`);
    return;
  }
  axErr('This statement is not supported by the Avalonia backend yet', st, modFile);
}

// ---------------- events ----------------

function emitAXEvent(st, modFile, lines, ctx, ind) {
  if (ctx.inHandler) axErr('Event handlers cannot be nested', st, modFile);
  if (!st.target || st.target.type !== 'VarRef') axErr('Events need a named element', st, modFile);
  const r = (st.target._resolved) || {};
  const kind = r.uiKind || (st.target.name === 'window' ? 'window' : null);
  if (!kind) axErr('Events need a known element type', st, modFile);
  const ev = st.event;
  const isWindow = st.target.name === 'window' && kind === 'window';
  const base = genAXExpr(st.target, st, modFile, ctx);
  // Named windows are dynamic: lifecycle events live on Window (not
  // Control), so cast. The implicit window is statically typed already.
  const wbase = (kind === 'window' && !isWindow) ? `((Window)(${base}))` : base;

  const sub = axCtx(ctx);
  sub.inHandler = true;
  const body = [];
  const put = (s) => body.push(ind + '    ' + s);
  let attach = null;
  let hoverAction = false;
  axHoistInto(st.body, sub, ctx, body, ind + '    ', [], true);
  const stdBody = (prefix) => {
    for (const p of prefix) put(p);
    for (const inner of st.body) emitAXStatement(inner, modFile, body, sub, ind + '    ');
    // Live inspector: refresh the snapshot after every handler runs
    // (no-op unless VEXEL_AX_SNAPSHOT is set).
    put('VexAx.Snap();');
  };

  if (ev === 'click' && (kind === 'button' || kind === 'window' || kind === 'text' || kind === 'image')) {
    if (kind === 'button') {
      stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
      attach = `((Button)(${base})).Click += (s, e) => {`;
    } else {
      // Labels, images and the window expose no Click: pointer press + position.
      stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
      attach = `((Control)(${base})).PointerPressed += (s, e) => {`;
    }
  } else if (ev === 'change' && kind === 'input') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    attach = `((TextBox)(${base})).TextChanged += (s, e) => {`;
  } else if (ev === 'change' && kind === 'checkbox') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    attach = `((CheckBox)(${base})).IsCheckedChanged += (s, e) => {`;
  } else if (ev === 'change' && kind === 'slider') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    attach = `((Slider)(${base})).ValueChanged += (s, e) => {`;
  } else if (ev === 'change' && (kind === 'dropdown' || kind === 'listbox' || kind === 'tree' || kind === 'tabbar')) {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    const ctl = kind === 'dropdown' ? 'ComboBox' : kind === 'listbox' ? 'ListBox'
      : kind === 'tree' ? 'TreeView' : 'TabControl';
    attach = `((${ctl})(${base})).SelectionChanged += (s, e) => {`;
  } else if (ev === 'change' && kind === 'table') {
    // Vexel 2.9: tables fire stored change handlers with the row index.
    const n2 = ctx.seq++;
    axHoistInto(st.body, sub, ctx, body, ind + '    ', [], true);
    lines.push(`${ind}{ dynamic __vex_tbl${n2} = (${base});`);
    lines.push(`${ind}VexAx.TableOnChange((object)__vex_tbl${n2}, (Action)delegate() {`);
    put(`dynamic v_event = VexAx.MakeEvent(__vex_tbl${n2});`);
    put(`v_event["value"] = VexAx.TableSelected(__vex_tbl${n2});`);
    for (const inner of st.body) emitAXStatement(inner, modFile, body, sub, ind + '    ');
    put('VexAx.Snap();');
    for (const bl of body) lines.push(bl);
    lines.push(`${ind}});`);
    lines.push(`${ind}}`);
    return;
  } else if (ev === 'double click' && (kind === 'button' || kind === 'text' || kind === 'image' || kind === 'toolbutton')) {
    // Vexel 3.0 Praxis: second press of a rapid pair (ClickCount guard).
    stdBody(['if (e.ClickCount != 2) return;', 'dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).PointerPressed += (s, e) => {`;
  } else if (ev === 'scroll' && kind === 'container') {
    // Vexel 3.0 Praxis: scroll areas report their vertical offset.
    // Non-scroll containers fail loudly at runtime (not silently).
    const n3 = ctx.seq++;
    axHoistInto(st.body, sub, ctx, body, ind + '    ', [], true);
    lines.push(`${ind}{ dynamic __vex_sc${n3} = ((Control)(${base}));`);
    lines.push(`${ind}VexAx.ScrollOn(__vex_sc${n3}, (Action)(delegate() {`);
    put(`dynamic v_event = VexAx.MakeEvent(__vex_sc${n3});`);
    put(`v_event["value"] = VexAx.ScrollOffset(__vex_sc${n3});`);
    for (const inner of st.body) emitAXStatement(inner, modFile, body, sub, ind + '    ');
    put('VexAx.Snap();');
    for (const bl of body) lines.push(bl);
    lines.push(`${ind}});`);
    lines.push(`${ind}}`);
    return;
  } else if (ev === 'change' && (kind === 'switch' || kind === 'radio')) {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    attach = kind === 'switch'
      ? `((ToggleSwitch)(${base})).IsCheckedChanged += (s, e) => {`
      : `((RadioButton)(${base})).IsCheckedChanged += (s, e) => {`;
  } else if (ev === 'change' && kind === 'numeric') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    attach = `((NumericUpDown)(${base})).ValueChanged += (s, e) => {`;
  } else if ((ev === 'change' || ev === 'key press' || ev === 'key release') && kind === 'search') {
    // Vexel 3.0 Praxis: search boxes behave like inputs.
    if (ev === 'change') {
      stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
      attach = `((TextBox)(${base})).TextChanged += (s, e) => {`;
    } else {
      sub.inKeyHandler = true;
      stdBody(['dynamic v_key = e.Key.ToString();', 'dynamic v_event = VexAx.MakeKeyEvent(v_key, s);']);
      attach = `((Control)(${base})).${ev === 'key press' ? 'KeyDown' : 'KeyUp'} += (s, e) => {`;
    }
  } else if (ev === 'click' && kind === 'menuitem') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `((MenuItem)(${base})).Click += (s, e) => {`;
  } else if (ev === 'click' && kind === 'toolbutton') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `((Button)(${base})).Click += (s, e) => {`;
  } else if (ev === 'click' && kind === 'table') {
    // Vexel 2.9: the table handle is a ScrollViewer (plain Control).
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).PointerPressed += (s, e) => {`;
  } else if (ev === 'click' && (kind === 'tree' || kind === 'tabbar')) {
    // Selection is the click for tree/tab controls.
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'v_event["value"] = VexAx.ChangeValue(s);']);
    const ctl = kind === 'tree' ? 'TreeView' : 'TabControl';
    attach = `((${ctl})(${base})).SelectionChanged += (s, e) => {`;
  } else if ((ev === 'key press' || ev === 'key release') && (kind === 'window' || kind === 'input')) {
    const wx = kind === 'window' ? base : `((Control)(${base}))`;
    sub.inKeyHandler = true;
    stdBody(['dynamic v_key = e.Key.ToString();', 'dynamic v_event = VexAx.MakeKeyEvent(v_key, s);']);
    attach = `${wx}.${ev === 'key press' ? 'KeyDown' : 'KeyUp'} += (s, e) => {`;
  } else if (ev === 'resize' && kind === 'window') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `${wbase}.SizeChanged += (s, e) => {`;
  } else if (ev === 'move' && kind === 'window') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `${wbase}.PositionChanged += (s, e) => {`;
  } else if (ev === 'close' && kind === 'window') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `${wbase}.Closed += (s, e) => {`;
  } else if ((ev === 'focus' || ev === 'blur') && kind !== 'window') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `((Control)(${base})).${ev === 'focus' ? 'GotFocus' : 'LostFocus'} += (s, e) => {`;
  } else if ((ev === 'focus' || ev === 'blur') && kind === 'window') {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `${wbase}.${ev === 'focus' ? 'Activated' : 'Deactivated'} += (s, e) => {`;
  } else if ((ev === 'press' || ev === 'mouse down') && !isWindow) {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).PointerPressed += (s, e) => {`;
  } else if ((ev === 'release' || ev === 'mouse up') && !isWindow) {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).PointerReleased += (s, e) => {`;
  } else if (ev === 'mouse move' && !isWindow) {
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).PointerMoved += (s, e) => {`;
  } else if ((ev === 'mouse enter' || ev === 'mouse leave' || ev === 'enter' || ev === 'leave' || ev === 'exit') && !isWindow) {
    const entered = (ev === 'mouse enter' || ev === 'enter');
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);', 'VexAx.FillPointer(v_event, s, e);']);
    attach = `((Control)(${base})).Pointer${entered ? 'Entered' : 'Exited'} += (s, e) => {`;
    hoverAction = false;
  } else if (ev === 'hover' && !isWindow) {
    // Real hover (400ms rest): needs an Action<object> delegate, not the
    // usual (s, e) lambda shape, so it gets its own attach wrapper.
    stdBody(['dynamic v_event = VexAx.MakeEvent(s);']);
    attach = `VexAx.OnHover(((Control)(${base})), (Action<object>)(delegate(object s) {`;
    hoverAction = true;
  } else {
    axErr(`Event '${ev}' on ${kind} is not supported by the Avalonia backend yet`, st, modFile);
  }

  lines.push(ind + attach);
  for (const b of body) lines.push(b);
  lines.push(ind + (hoverAction ? '}));' : '};'));
}

// ---------------- functions and components ----------------

// A Vexel function becomes a method on VexProgram. Parameters and locals
// are `dynamic`; module-level names are class fields, so functions share
// globals exactly like the other backends (no shadowing surprises).
function emitAXFunction(st, modFile, methods, prefix, scope, prefixOf) {
  const sub = axCtx(null);
  sub.prefix = prefix; sub.prefixOf = prefixOf; sub.scope = scope;
  // Params arrive as strings (semantic descriptors) or {name} (AST).
  const pnames = (st.params || []).map((p) => (typeof p === 'string' ? p : p.name));
  for (const pn of pnames) sub.declared.add(pn);
  const body = [];
  // Function bodies bind every assignment locally (proven by semantic
  // binding rules), so hoist everything not already declared.
  for (const n of collectAXAssigns(st.body)) {
    if (sub.declared.has(n) || n === 'key' || n === 'event') continue;
    sub.declared.add(n);
    body.push(`            dynamic v_${sanitizeIdent(n)} = null;`);
  }
  for (const inner of st.body || []) emitAXStatement(inner, modFile, body, sub, '            ');
  const ps = pnames.map((pn) => `dynamic v_${sanitizeIdent(pn)}`).join(', ');
  methods.push(`    // function ${st.name} (${pnames.join(', ')})
    public static dynamic F_${prefix}_${sanitizeIdent(st.name)}(${ps}) {
${body.join('\n')}
            return null;
        }`);
}

function emitAXComponent(st, modFile, methods, prefix, scope, prefixOf) {
  const sub = axCtx(null);
  sub.prefix = prefix; sub.prefixOf = prefixOf; sub.scope = scope;
  const body = [];
  axHoistInto(st.body, sub, sub, body, '            ', [], false);
  for (const inner of st.body || []) emitAXStatement(inner, modFile, body, sub, '            ');
  methods.push(`    // component ${st.name}
    public static void C_${prefix}_${sanitizeIdent(st.name)}() {
${body.join('\n')}
        }`);
}

// ---------------- project ----------------

function generateAX(loadResult, analyzeResult) {
  const { modules, order } = loadResult;
  const { scopes } = analyzeResult;
  const norm = (p) => path.normalize(p);
  const prefixMap = buildPrefixes(order);
  const prefixOf = (absPath) => prefixMap.get(norm(absPath));

  // Unwrap `public <decl>` to its inner declaration for collection.
  const unwrap = (st) => (st && st.type === 'PublicDecl' ? (st.decl || st) : st);

  const fields = [];
  const methods = [];
  const inits = [];
  for (const absPath of order) {
    const scope = scopes.get(norm(absPath));
    const mod = modules.get(norm(absPath));
    const modFile = mod.file || absPath;
    const p = prefixOf(absPath);
    // Top-level variable statics (a UI element literally named `output`
    // still needs storage, like the WinForms backend).
    for (const [name] of scope.variables) {
      if (name === 'output') continue;
      fields.push(`    static dynamic ${p}_${sanitizeIdent(name)};`);
    }
    if (scope.variables.has('output')) {
      fields.push(`    static dynamic ${p}_output;`);
    }
    fields.push(`    static bool ${p}__initDone = false;`);
    // Functions, components, theme builders.
    for (const [, fn] of scope.functions) {
      emitAXFunction(fn, modFile, methods, p, scope, prefixOf);
    }
    for (const [, comp] of scope.components) {
      emitAXComponent(comp, modFile, methods, p, scope, prefixOf);
    }
    // TODO(v2.2.1): theme builders (genCSTheme equivalent).
    // Init (top-level statements run against statics; no locals here).
    // StyleDecl/ThemeDecl create runtime objects in flow order.
    const ctx = axCtx(null);
    ctx.prefix = p; ctx.prefixOf = prefixOf; ctx.scope = scope;
    const lines = [];
    for (const st of mod.ast.body) {
      if (!st) continue;
      const d = unwrap(st);
      if (d.type === 'ImportDecl' || d.type === 'StructDecl' || d.type === 'EnumDecl' || d.type === 'TestBlock' || d.type === 'FuncDecl' || d.type === 'ComponentDecl') continue;
      emitAXStatement(st, modFile, lines, ctx, '        ');
    }
    inits.push(`    static void ${p}_init() {`);
    inits.push(`        if (${p}__initDone) return;`);
    inits.push(`        ${p}__initDone = true;`);
    for (const l of lines) inits.push(l);
    inits.push('    }');
  }

  const programCs = `// Generated by Vexel 2.2 (Vexel -> C# Avalonia -> native). Do not edit.
using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;

public class VexApp : Application {
    public override void OnFrameworkInitializationCompleted() {
        try {
            VexAx.ApplyTheme(this);
            VexProgram.BuildUI();
        } catch (Exception ex) {
            string msg = ex is VexAxErr ? ex.Message : "UI Error: " + ex.Message;
            Console.Error.WriteLine("Vexel Error\\n\\n" + msg);
            Environment.Exit(1);
        }
        if (VexAx.ShownWins.Count > 0 && ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desk) {
            // Every presented window shows; the app exits with the last
            // one (closing one window never kills the others).
            desk.ShutdownMode = ShutdownMode.OnLastWindowClose;
            desk.MainWindow = VexAx.ShownWins[0];
        } else {
            Environment.Exit(0);
        }
        base.OnFrameworkInitializationCompleted();
    }
}

public static class VexProgram {
    [STAThread]
    public static void Main(string[] args) {
        AppBuilder.Configure<VexApp>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace()
            .StartWithClassicDesktopLifetime(args);
    }

    public static void BuildUI() {
${order.map((absPath) => `        ${prefixOf(absPath)}_init();`).join('\n')}
    }
${fields.join('\n')}
${methods.join('\n')}
${inits.join('\n')}
}
`;

  const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>${AX_TFM}</TargetFramework>
    <Nullable>disable</Nullable>
    <AssemblyName>VexApp</AssemblyName>
    <RootNamespace>VexApp</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Avalonia" Version="${AX_VERSION}" />
    <PackageReference Include="Avalonia.Desktop" Version="${AX_VERSION}" />
    <PackageReference Include="Avalonia.Themes.Fluent" Version="${AX_VERSION}" />
    <PackageReference Include="Avalonia.Fonts.Inter" Version="${AX_VERSION}" />
  </ItemGroup>
</Project>
`;

  return { programCs, csproj, axVersion: AX_VERSION, tfm: AX_TFM };
}

module.exports = { generateAX, AX_VERSION, AX_TFM };
