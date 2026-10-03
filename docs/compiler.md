# Vexel — Compiler Architecture

> v1.1.0 adds a second backend: UI programs (containing
> `create a window`) go through the same frontend, then
> `compiler/codegen/codegen_cs.js` transpiles to C# WinForms and the
> inbox `csc.exe` builds a native desktop `.exe`. Console programs
> still use the Rust backend below. See `docs/ui.md`.

```
.vxl source
  ↓  Lexer (compiler/lexer) — tokens + line/column, // comments
  ↓  Parser (compiler/parser) — recursive descent, AST (compiler/ast)
  ↓  Modules (compiler/modules) — import graph, topo order, cycle check
  ↓  Semantic (compiler/semantic) + Types (compiler/types)
  │    undefined vars/functions, duplicates, arity, field validation,
  │    visibility (public/private), return placement, type inference
  ↓  Codegen (compiler/codegen) — AST -> Rust source (IR)
  ↓  rustc --edition=2021 -O (native backend)
  ↓  Native executable (.exe on Windows)
```

## Why Rust via rustc?

Vexel needs true native executables without shipping an interpreter
or a large toolchain. Generating Rust and invoking the installed
`rustc` gives:

- No extra backend to maintain (LLVM bindings, assembler, linker).
- Memory-safe generated code (bounds checks, no raw pointers).
- Single-file output, `-O` optimized, no Vexel source embedded.

The compiler itself is written in Node.js (no dependencies), which is
allowed: the *initial* compiler may be written in another language.
What matters is that Vexel programs compile to native executables
instead of being line-by-line interpreted. You can verify with
`vexel build hello.vxl` (produces `hello.exe`) and by inspecting the
intermediate `.rs` (pass `--keepRust` internally or check temp output).

## Runtime (runtime/vex_runtime.rs)

A small embedded Rust library (~500 lines, no crates):

- `VexVal` tagged union: Int(i64), Float(f64), Bool, Str(String),
  List(Rc<RefCell<Vec>>), Struct(Rc<RefCell<...>>), Null.
- Arithmetic/comparison/logic with checked ops and clear errors.
- Globals in `thread_local!` HashMap (mangled keys per module).
- `output` buffer, RNG (xorshift), input, file read, string/list ops.
- Errors as `Result<_, String>`; `try/error` becomes Rust closures
  capturing `Err` into `__vex_error`. Uncaught errors print to
  stderr and exit non-zero.

Static typing is enforced *before* codegen; the runtime uses the
uniform `VexVal` representation for simplicity (standard for v0.1
compiled languages). Invalid programs never reach `rustc`.

## Diagnostics (compiler/diagnostics)

Every compile error includes type, file, line, column, source line,
and a `^` indicator. No stack traces leak to users.

## Name mangling

Each module gets a prefix `m<order>_<basename>` (e.g. `m1_player`).
Globals become `m1_player__name`, functions `m1_player__greet`,
inits `m1_player__init` with an `AtomicBool` once-guard. This keeps
`player.attack` and `enemy.attack` distinct and implements
execute-once imports.
