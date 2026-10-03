# Vexel v3.7.0 — Atlas Model Loading

> Vexel 3.7 completes Atlas v0.5 (models): `load model` / `create
> model` / `save model` / `model info`, a real `Model` value with
> `forward`, `eval` / `train`, and `with inference`, loading native
> `model.atlas` (CRC32-protected) or SafeTensors (single or sharded)
> folders — deterministic create and save, exact round-trips.
> Hugging Face configs and repo ids are refused honestly — Atlas
> never touches the network. Models move to the GPU
> (`move m to gpu`) and `forward` places inputs on the model's
> device; UI programs reject model syntax with a clear console-only
> error. Vexel 3.6's GPU tensors, autograd, and `nn.vxl` keep
> working unchanged.

Vexel is a small, readable, English-like **statically compiled**
programming language — now with enums, pattern matching, terminal
sessions, filesystem APIs, CLI arguments, a test system, console tasks,
fuller HTTP, incremental builds, and UI additions (shortcuts, toolbar
groups, rendering data tables). It looks like this:

```vxl
function greet name {
    print "Hello " + name
}

greet "Zen"
```

No parentheses. No semicolons. Automatic types. Native executables.

First program:

```vxl
print "Hello World!"
```

```bash
vexel hello.vxl
# Hello World!
```

---

## 1. What Vexel is

- Simple, readable, English-like (`and`/`or`/`not`, `repeat`, `make upper`).
- Statically compiled: Lexer → Parser → AST → Semantic/TypeCheck → Rust IR → `rustc` → native exe.
- Automatically typed: `age = 25` infers `integer`; strong checking after inference.
- General-purpose v1.1.0: console, files, random, lists, strings, structs, functions, modules, errors — plus native desktop GUI apps.
- Not an interpreter: `vexel build` produces a real native executable; running never interprets `.vxl` line-by-line.
- Two native backends: console programs compile via Rust (`rustc`); UI programs (`create a window ...`) compile to real Avalonia desktop apps (.NET 8 SDK).

## 2. Install

### From npm (recommended — works on any collab/cloud dev box)

```bash
npm install -g vexel-lang
vexel version
# vexel 3.7.0
```

Requirements: **Node.js ≥ 18** and **rustc** (Rust stable) — Vexel
translates to Rust and invokes `rustc` (install Rust from
https://rustup.rs). UI programs additionally need the **.NET 8 SDK**;
the GPU backend builds itself on demand with cargo, nothing to set
up. First run needs no extra files: the package ships the compiler,
the runtime sources, the GPU crate, and the `atlas.vxl` / `nn.vxl`
libraries.

### On Replit (collab coding)

Import this repo (GitHub import or upload the folder) — `.replit` and
`replit.nix` provide Node + Rust automatically, and **Run** compiles
and executes `main.vxl`. The Repl also installs `vexel` as a global
command on boot (`npm install -g .`), so collaborators can run
`vexel run anything.vxl` in the Shell. Console, tensors, and Atlas
models work on Replit; native GUI windows need a desktop OS, and the
GPU path needs a machine with a GPU.

### On Google Colab / Kaggle (notebook VMs)

Open the ready-made notebook in Colab:

https://colab.research.google.com/github/coolgamer203695-cyber/vexel/blob/main/notebooks/quickstart.ipynb

Or in any Ubuntu notebook (Kaggle: enable **Settings → Internet**
first) run this cell:

```python
!test -d vexel || git clone --depth 1 https://github.com/coolgamer203695-cyber/vexel
!bash vexel/tools/install_notebook.sh vexel
```

The script installs Node + Rust only if missing, installs the `vexel`
CLI, and self-tests — afterwards `!vexel run vexel/main.vxl` works in
any later cell. Re-run it once per session (VMs are wiped).

### From source

```bash
git clone <this-repo>
cd vexel
node bin\vexel.js --help
# or install the checkout globally:
npm install -g .
```

No `npm install` of third-party packages is needed (zero
dependencies).

On Windows PowerShell you can also run `.\vexel.cmd` or
`node bin\vexel.js` directly.

## 3. Compile a program

```bash
vexel build hello.vxl
# Built .../hello.exe (Windows) or .../hello (Unix)
```

This runs the full pipeline and invokes `rustc --edition=2021 -O`.
The output is a native executable next to the source.

## 4. Run a program

```bash
vexel hello.vxl
vexel run hello.vxl
./hello.exe        # or ./hello on Unix (after build)
vexel check hello.vxl  # type-check only, no codegen
```

`vexel hello.vxl` compiles to a temp native exe and runs it with
`cwd` set to the source directory (so `data/info.txt` resolves).
`stdin`/`stdout` are inherited, so `add input` works interactively.

## 5. Basic syntax

- Comments: `// to end of line`.
- No `;`. Blocks use `{` `}`. Newlines separate statements.
- Function call args must be on the same line as the function name.
- Struct type names should start with uppercase (`Player`).

```vxl
// comment
print "Hello"
```

## 6. Variables

```vxl
name = "Zen"
age = 25
ready = true
price = 19.99
```

No `let`/`var`/`const`.

## 7. Types

`integer`, `decimal`, `boolean`, `string` (+ `list`, structs).
Inferred automatically, checked statically. Reassignment with a
different type fails at compile time.

## 8. Conditions

```vxl
if age >= 18 {
    print "Adult"
} else if age >= 13 {
    print "Teenager"
} else {
    print "Child"
}
```

Comparisons: `== != > < >= <=` (single `=` also means equality
inside expressions/conditions).

## 9. Loops

```vxl
repeat 5 {
    print "Hello"
}

x = 0
repeat till x = 100 {
    print x
    x = x + 1
}
```

`repeat till` checks before each iteration and stops when true.
No `inf` loop in v0.1.

## 10. Functions

```vxl
function hello {
    print "Hello World!"
}
hello

function greet name {
    print "Hello " + name
}
greet "Zen"

function add a, b {
    return a + b
}
result = add 10, 20
```

No parentheses. Arity is checked. Params/locals are function-scoped
and do not leak to globals.

## 11. Lists

```vxl
names = ["Zen", "Alex", "John"]
print names[0]
names[1] = "Mike"
names.add "Sarah"
names.remove 0
print names.length
```

Bounds-checked; violations are catchable runtime errors.

## 12. Strings

```vxl
name = "Zen"
print "Hello " + name
print length of name
print [0] from name
make name upper
make name lower
```

`string + int/decimal/bool` coerces to string.

## 13. Structs

```vxl
struct Player {
    name
    age
    level
}
player = Player {
    name = "Zen"
    age = 25
    level = 10
}
print player.name
player.age = 26
```

Unknown fields are compile errors when the type is known.

## 14. Input

```vxl
add input "What is your name?"
set output = x
print x
```

`output` is the last input; `set output = x` copies it into `x`.
`output = 1` uses it as an ordinary variable.

Input is always text — convert it with `number of` before math:

```vxl
add input "First number:"
set output = first
a = number of first
```

See `examples/calculator.vxl` for a full input-driven calculator.

## 15. Random numbers

```vxl
number = r from 1 to 100
```

Inclusive integer range.

## 16. Imports

```vxl
import entities/player
```

resolves to `entities/player.vxl` relative to the importing file.
The `.vxl` extension is omitted; the module name is the filename.

## 17. Public declarations

Private by default; expose with `public`:

```vxl
public name = "Zen"
public function greet {
    print "Hello"
}
```

## 18. Modules

```vxl
import entities/player
print player.name
player.greet
```

Members are accessed via the namespace (`player.`). Private members
(`player.secret`) fail with `VisibilityError`. Separate modules can
both define `attack` (`player.attack` vs `enemy.attack`). Top-level
code runs on import, exactly once. Circular imports are rejected.

## 19. Error handling

```vxl
try {
    print data/info.txt
} error {
    print error
}

function divide a, b {
    if b = 0 {
        error "Cannot divide by zero"
    }
    return a / b
}
```

`error` in the catch block is the message string. Uncaught runtime
errors print to stderr and exit non-zero (never corrupt memory).

## 20. File reading

```vxl
print data/info.txt
```

prints text. `import` executes modules; `print <path>` only reads.
Missing files are runtime errors (catchable). If the path has no
extension, `.vxl` is also tried (so `print entities/player` shows
source without executing it).

## 21. Current limitations of v0.1

- Function call args must be on one line; no multi-line calls.
- `print <a/b>` with `/` is always a file path; use `print (a / b)`
  or a temp var for division in print.
- Struct names should be Uppercase (lowercase `ident {` is a block).
- Function named `add` is supported (spec requires it); other
  keywords cannot be function names.
- `/` on integers yields decimal; `%` requires integers.
- No classes, generics, threads, async, macros, or GC (by design).
- Single-threaded runtime; `rustc` must be installed.
- File paths for `print` should use alphanumerics/`_`/`/`/`.`.

---

## 22b. Vexel 2.0 — What's new

Manual positioning is the default (no forced grid):

```vxl
button.x = 100
button.y = 150
button.width = 200
button.height = 50
```

New widgets (`panel`, `scroll area`, `form`), new methods
(`button.show`, `button.hide`, `button.focus`, `list.clear`,
`button.center`), element removal (`remove button`), UI ids with
`find`, reusable styles, `set theme to`, timers, clipboard,
folders, JSON, and a bigger event system with an `event` object:

```vxl
window.on mouse move {
    print event.x
}

button.on click {
    print event.button
}

every 1 second {
    print "tick"
}

style main_button {
    background = "#202020"
    font_size = 18
}

button.style = main_button

data = json read "config.json"
print data.name
```

Language additions: `null`, `{...}` objects, `make x number`,
rich `error.message` / `error.type` / `error.file`, import
aliases (`import a/b as c`), and projects:

```bash
vexel create my_app
vexel run
vexel build
vexel clean
vexel debug main.vxl
```

Full guide: `docs/v2.md` (with UI: `docs/ui.md`).

## 22c. Vexel 2.9 — What's new

Enums, pattern matching, safer nulls, terminal sessions, filesystem
APIs, CLI arguments, `test` blocks with `vexel test`, staged
`vexel check`, better diagnostics, console tasks with `wait`, fuller
HTTP (`post`/`put`/`patch`/`delete`, headers, timeouts), incremental
builds, shortcuts, toolbar separators/groups, rendering data tables
with selection, and `vexel debug --dpi`:

```vxl
enum State {
    idle
    running
}

state = State.running

match state {
    idle {
        print "Waiting"
    }
    running {
        print "Go!"
    }
}

test "state" {
    assert state = State.running
}
```

```bash
vexel test
vexel check
vexel debug --dpi all app.vxl
```

Full guide: `docs/v2.9.md`. Every snippet there was compiled; runnable
ones were executed.

## 22. Vexel 1.1.0 — Native GUI apps

Write desktop apps in the same English-like style:

```vxl
create a window titled "My App"

set window width to 800
set window height to 600

title = add a text titled "Welcome to Vexel!"
input = add an input box titled "Enter your name"
button = add a button titled "Say Hello"
output = add an output box

button.on click {
    output.text = "Hello " + input.text
}

window.show
```

```bash
vexel app.vxl   # opens a real desktop window
```

Widgets: text, button, input/output boxes, checkbox, slider,
progress bar, dropdown, list, image, menu, toolbar, tab bar, table,
tree, spinner, containers (plain/horizontal/vertical/grid/scroll).
Plus: auto layout (`center`, spacing, padding, percent/fill),
styling + `dark`/`light`/custom themes, events (`click`, `change`,
`key press` with `key`), dialogs, file/color pickers, animations,
and reusable `component` blocks.

```vxl
volume = add a slider
volume.minimum = 0
volume.maximum = 100

volume.on change {
    print volume.value
}
```

Full guide: `docs/ui.md`. Examples: `examples/ui/`
(hello, counter, greeting, settings, acceptance).

Notes:

- UI programs compile to native Avalonia `.exe` files via the
  .NET 8 SDK (plus Avalonia native DLLs beside the exe).
  Console programs still use the Rust backend; `print` in UI apps
  goes to the terminal.
- `[i] from value` now works on lists too: `print [0] from list`.
- UI needs a window first (`create a window ...`), one window per
  program, and event handlers cannot use `return`.
- Fading applies to the window only; `fade` on a control is a
  compile-time error on this backend.

---

## Examples

See `examples/`: `hello.vxl`, `variables.vxl`, `arithmetic.vxl`,
`conditions.vxl`, `logic.vxl`, `loops.vxl`, `functions.vxl`,
`lists.vxl`, `strings.vxl`, `structs.vxl`, `random.vxl`,
`input.vxl`, `files.vxl`, `errors.vxl`, `full_test.vxl`,
`main.vxl` + `entities/player.vxl`, `data/info.txt`.

Module test:

```
examples/
  main.vxl            # import entities/player; print player.name; player.greet
  entities/player.vxl # public name/greet, private secret
```

Full test (`full_test.vxl`) exercises structs, functions, fields,
random, conditions, loops, and input.

## Tests

```bash
node tests/run_tests.js        # 1.0 console suite
node tests/ui/run_ui_tests.js  # 1.1.0 UI suite (incl. live window probe)
node tests/v29/run_v29_tests.js  # 2.9 feature suite (all groups)
```

The console suite covers lexer, parser, types, functions, structs,
modules, errors, and end-to-end native execution (output compared
exactly). The UI suite covers widget compilation, UI diagnostics,
codegen, native Avalonia builds, live windows, clicks, timers,
tasks, processes, pixels, and the multi-module import path.
The 2.9 suite covers enums, null safety, pattern matching, terminal
sessions, filesystem, CLI arguments, projects, staged check, the test
runner, diagnostics, console tasks, HTTP methods, incremental builds,
and UI additions (including a live table/shortcut interaction).

## Architecture

See `docs/compiler.md`, `docs/language.md`, and `docs/ui.md`.

```
.vxl → Lexer → Parser → AST → Modules → Semantic/Types → backend → exe
```

Backends: Rust via `rustc` (console programs), C# via .NET 8 +
Avalonia 11 (UI programs - detected automatically).

- `compiler/lexer`, `parser`, `ast`, `semantic`, `types`,
  `modules`, `codegen` (Rust + C# backends), `diagnostics`
- `runtime/vex_runtime.rs` — console runtime (VexVal, IO, errors)
- `runtime/ui/` - UI runtime (`backend/avalonia/VexAx.cs`: values,
  widgets, layout, events, styling, tasks, HTTP, processes)
- `bin/vexel.js` — CLI (`run`/`build`/`check`/`test`/`debug`/`--version`/`--help`)
- `tests/`, `tests/ui`, `tests/v29` (2.9 suite), `examples/`,
  `examples/ax`, `docs/` (incl. `v2.9.md`, `plan-2.9.md`),
  `tools/` (pixel verification harness)

## Project structure

```
vexel/
  bin/vexel.js  vexel.cmd  vexel
  compiler/lexer  parser  ast  semantic  types  modules  codegen  diagnostics
  runtime/vex_runtime.rs  runtime/ui (backend/avalonia/VexAx.cs)
  tests/lexer parser types functions structs modules errors programs + run_tests.js
  tests/ui (run_ui_tests.js)
  examples/*.vxl  examples/entities/*.vxl  examples/data/info.txt
  examples/ui (hello, counter, greeting, settings, acceptance, full)
  docs/language.md  docs/compiler.md  docs/ui.md
  site/index.html  (learning website — double-click to open in a browser)
  package.json  README.md
```
