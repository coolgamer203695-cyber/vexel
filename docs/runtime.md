# Vexel 2.2 runtime notes

Vexel 2.2 keeps all 2.0/2.1 syntax and behavior, and pins down the
runtime underneath it: coordinates, windows, timers, lifecycle,
shutdown, and debugging.

## Coordinate system

- `x`, `y`, `width`, `height` are absolute client-area pixels.
- Direct children of a window are relative to the window's client
  area (below the title bar), never the OS window frame.
- Children of a container are relative to that container:
  `screen = parent + child`.
- `right = x + width`, `bottom = y + height`. Positions are never
  cumulative across siblings.
- Manual positioning is the default. Layout (stacking, flow, grid)
  only happens inside containers you explicitly create. An explicit
  `x`/`y` always wins and opts out of auto-stacking.
- The default root panel has zero padding: `a.x = 20` renders at
  pixel 20 of the content area.

## DPI

Scaling happens exactly once, inside the backend
(`AutoScaleMode.Dpi` on the main window). Vexel coordinates stay
deterministic across machines and across 100%/125%/150%/200%
settings. The compiler never pre-scales coordinates.

## Windows

One window per program (`create a window titled "..."`).
Methods: `show`, `hide`, `close`, `minimize`, `maximize`,
`restore`, `center`, `focus`.

Lifecycle events on the window:

```vxl
window.on resize {
    print "Window resized"
}

window.on move {
    print "Window moved"
}

window.on close {
    print "Goodbye"
}
```

`close` fires on `FormClosed`. Inside these handlers `event` carries
`target` only (`event.x`/`event.key` are compile-time errors there).

## Timers

Bare timers are fire-and-forget:

```vxl
every 1 second {
    print "tick"
}
```

Named timers return a handle you can cancel:

```vxl
ticker = every 1 second {
    print "tick"
}

stopper = after 5 seconds {
    ticker.cancel
}
```

- `timer.cancel` stops all future ticks, removes the timer from the
  schedule, and releases its resources. Cancelling twice is safe.
- One-shot (`after`) timers complete and release themselves.
- A body that throws marks the timer `failed` and stops it instead
  of crashing the app.
- Timers tick on the UI thread: bodies touch controls as safely as
  click handlers do.
- `timer.cancel` on a non-timer is a compile-time error
  (`has no field` / `Undefined variable` / `Unknown timer action`).

## Lifecycle and shutdown

```text
Program starts -> Runtime init -> Modules init -> UI init
  -> Event loop (OS/UI events, timers, handlers)
  -> Window closes -> Stop timers -> Close windows
  -> Release resources -> Shutdown
```

Closing the main window deterministically stops every live timer,
so no timer keeps the process alive or fires after shutdown.

## Debugging positions

`vexel debug program.vxl` prints a static Geometry section
(`name: kind x=.. y=.. w=.. h=.. (in parent)`) plus Warnings for:

- right/bottom edge exceeding the parent (`window` defaults to
  800x600 unless resized),
- negative `x`/`y`/`width`/`height`,
- duplicate control `id` values.

```text
a: button x=20 y=20 w=50 h=50 (in window)
Warnings: none.
```

## What 2.2 still leaves out

Toolbars, data tables, process execution, responsive anchoring,
and DPI-level tests remain roadmap items. Everything else in the
2.2 brief is implemented on the Avalonia backend and proven below.

## Avalonia backend (2.2.1: the default)

`vexel build app.vxl` compiles UI programs to .NET 8 +
Avalonia 11 apps. Same Vexel language, no
Avalonia names in `.vxl` sources.

Supported: named windows (unlimited) + implicit window; button,
text, input, output, checkbox, slider, progress, dropdown,
listbox, image, spinner, menu, tab bar, tree widgets; explicit
containers (panel, horizontal, vertical, grid, scroll); geometry
and common props (checked, value, minimum, maximum, step,
selected_index, placeholder, password, source, visible, enabled,
font_size, bold, italic, opacity, background/border/padding/margin
families, alignment, font); variables, arithmetic, comparisons,
`if`, loops, `print`, JSON read/write, `try`/`error`, `wait`,
`make`, `number of`, indexing, random, lists; click/change/
keyboard/focus/mouse/resize/move/close handlers with
`event`/`key`; window and control methods; bare and handle timers;
background tasks with state/result/error/cancel; real HTTP;
message/warning dialogs, yes/no asks, file/folder/color pickers,
clipboard; remove, center, min/max, fill, percent sizes, themes
and styles; functions, components, structs, modules.

Deliberately rejected with a clear `BackendError` (not faked):
anything outside the surface above (unknown widgets, unknown
events/props for a kind, nested handlers).

Notes:

- Key names come from the backend (`A`, `D0`-`D9`, `Space`,
  `Return`, `Back`, `Escape`, ...). `A` verified live.
- Conditions treat `false`, `null`, `0`, and `""` as false.
- `print` writes to the parent console when launched from one.
- Window `width`/`height` set the client area (verified: a 600
  client grown by +200 moves right-anchored controls by exactly
  +200).
- Examples: `examples/ax/counter.vxl`, `keys.vxl`, `widgets.vxl`,
  `windows.vxl`, `timers.vxl`.

## Responsive anchoring (2.2.1)

Explicit coordinates never move on resize — unless anchored:

```vxl
rightBtn.anchor = "right"        # keeps right margin
wide.anchor = "left right"       # stretches horizontally
tall.anchor = "top bottom"       # stretches vertically
corner.anchor = "bottom right"   # keeps both margins
```

Unset (or `"top left"`) keeps `x`/`y` unconditionally. Unknown
edges fail loudly at runtime with the valid list (`left`, `right`,
`top`, `bottom`; `none` clears all rules).
Anchors track the parent (window client area or container canvas)
and recompute only on real resizes.

## Multi-window programs (phase 3)
Name each window to own more than one:

```vxl
main = create a window titled "Main"
settings = create a window titled "Settings"

main.width = 600
main.height = 400

main.show
settings.show
```

Rules:

- One anonymous `create a window` per program; named windows are
  unlimited. The implicit `window` is the first created window.
- Widgets without `to` belong to the most recently created window.
  `add a button titled "Hi" to settings` parents explicitly.
- Each window has its own size, controls, events, and lifecycle.
  Methods (`show`, `hide`, `close`, `minimize`, `maximize`,
  `restore`) and events (`resize`, `move`, `close`, `focus`,
  `blur`, `key press`) target the named object:
  `settings.on close { ... }`.
- Closing one window never closes the others; the app exits with
  the last window.
- Example: `examples/ax/windows.vxl`.

## Containers (phase 5)

Explicit layout containers (manual positioning stays the default):

```vxl
p = create a container
p.x = 50
p.y = 50
p.width = 300
p.height = 200

inner = add a button titled "In"
inner.x = 20
inner.y = 20

add inner to p
```

- `create a container` (absolute panel), `create a horizontal
  container`, `create a vertical container`, `create a grid
  container` (2 auto columns), `create a scroll container`.
- Children of a panel/scroll canvas use parent-relative coords:
  screen = parent + child. Stack/grid children are arranged by the
  container (their `x`/`y` is ignored).
- `add X to Y` re-parents (moves) a control; `add ... to <window>`
  targets a window explicitly.
- Relative expressions work everywhere:
  `below.y = inner.y + inner.height + 10`.
- Example: `examples/ax/containers.vxl`.

## Opacity and animation (phase 6)

Per-control opacity is real (this is why the backend moved):

```vxl
box.opacity = 0.5
```

Values must satisfy `0 <= opacity <= 1` (literals are checked at
compile time, everything at runtime). Animations run on the UI
thread at 60fps without blocking it:

```vxl
animate box {
    move to x 200
    fade to 0.9
    duration 1 second
}
```

Easing is linear.
Example: `examples/ax/animations.vxl`.

## Background tasks + HTTP (phase 7)

Long work runs OFF the UI thread; the window never freezes:

```vxl
task fetch {
    response = http get "https://example.com"
    result = response.status
}

watcher = every 1 second {
    if fetch.state = "completed" {
        display.text = fetch.result
        watcher.cancel
    }
}
```

- Task states: `pending`, `running`, `completed`, `failed`,
  `cancelled`. Read them with `handle.state` (a string).
- `handle.result` returns whatever the body assigned to `result`
  (locked handoff — no shared mutation, no marshaling).
- `handle.cancel` is cooperative: loop heads and `wait` abort
  promptly; in-flight HTTP requests cancel via token; pure compute
  finishes (cancel arriving too late leaves `completed`).
- Failures land in `handle.error.message` (a proper error object,
  never silent). Touching UI from a worker fails the task with
  guidance to poll from a timer instead.
- `response = http get "url"` returns `status`, `text`, `body`,
  `headers`. Default timeout 30s. Network failures become catchable
  Vexel errors naming the URL and reason — never raw crashes, never
  hangs. Timeouts, DNS failures, bad URLs all map cleanly.
- Task bodies are isolated scopes: fresh locals, no outer locals,
  a pre-declared `result`. Module globals stay visible (read-only
  by convention — writes from workers race by design).
- Forbidden inside tasks (clear errors): declarations, windows,
  timers, event handlers, `window.show`.
- Console programs reject tasks at semantic
  level (tasks need a window).
- Examples: `examples/ax/tasks.vxl`, `http.vxl`, `http_task.vxl`.
