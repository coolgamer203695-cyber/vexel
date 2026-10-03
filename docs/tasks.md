# Vexel tasks (2.2)

Background work that never freezes the window.

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
    if fetch.state = "failed" {
        display.text = fetch.error.message
        watcher.cancel
    }
}
```

## States

`pending` → `running` → `completed` | `failed` | `cancelled`.
Poll `handle.state` from a timer (timers run on the UI thread, so
reads are safe). A task cancelled before starting never runs.

## Result

Assign to `result` inside the body; read `handle.result` after
`completed`. The handoff is locked — no shared mutation, no
dispatcher calls in user code.

## Cancellation

`handle.cancel` is cooperative:

- loop heads (`repeat`) and `wait` abort promptly,
- in-flight HTTP cancels through its token,
- pure compute with no checkpoints runs to `completed`
  (a cancel that arrives too late is honestly reported).

## Errors

Any throw in the body → `failed`, message in `handle.error.message`
(an error object with `message`/`type`). Touching UI controls from
a worker fails the task and tells you to poll from a timer instead.

## Scope rules

Fresh locals, no outer locals, pre-declared `result`. Module
globals are visible (treat as read-only — concurrent writes race).
No declarations, windows, timers, event handlers, or `window.show`
inside a task body.

## Backend

Tasks need `--avalonia`. Shutdown cancels all live tasks when the
last window closes.
