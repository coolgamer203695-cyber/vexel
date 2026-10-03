# Vexel 1.1.0 — UI Guide

Vexel UI reads like English. There are no constructors, no XML, no CSS.
Every example below is a complete program you can run with:

```bash
vexel app.vxl
```

UI programs compile to real native desktop apps (Avalonia via
the .NET 8 SDK). Console output (`print`) still goes to the terminal, so run
UI apps from a terminal to see both.

Rule zero: create the window first. Everything else builds on it.

```vxl
create a window titled "My App"

window.show
```

## 1. Windows

```vxl
create a window titled "My App"

set window width to 900
set window height to 600
set window resizable to true

window.show
```

More window control:

```vxl
create a window titled "My App"

window.width = 800
window.height = 600
window.title = "New Title"
set window position to 100, 200
set window min width to 400
set window max height to 900
set window fullscreen to false
window.hide
window.minimize
window.maximize
window.close
```

`window.show` starts the app and keeps it alive until the window
closes, so it is normally the last line. If you forget it, Vexel
shows the window for you at the end.

## 2. Buttons

```vxl
create a window titled "My App"

button = add a button titled "Click Me"

button.title = "Start"
button.enabled = true

button.on click {
    print "Clicked!"
}

window.show
```

Buttons support `title`, `text`, `width`, `height`, `x`, `y`,
`enabled`, `visible`, `font`, `font_size`, `bold`, `italic`,
`background`, `text_color`, `border`, `border_radius`, `opacity`
(no — see below), `padding`, `margin`. Events: `click`, `press`,
`release`, `hover`, `enter`, `leave`.

```vxl
create a window titled "My App"

button = add a button titled "Click Me"

button.background = "blue"
button.text_color = "white"
button.font_size = 18
button.border_radius = 10

button.on hover {
    print "Mouse is over the button"
}
```

Note: `opacity` works on the window only. Setting it on a button is
a compile-time error.

## 3. Text

```vxl
create a window titled "My App"

title = add a text titled "Welcome!"

title.font_size = 24
title.bold = true
title.text = "Welcome to Vexel!"

window.show
```

Labels support `alignment` (`left`, `center`, `right`):

```vxl
create a window titled "My App"

title = add a text titled "Hi"

title.alignment = "center"
```

## 4. Input boxes

```vxl
create a window titled "My App"

input = add an input box titled "Enter your name"

input.text = "Hello"

input.on change {
    print input.text
}

input.clear

window.show
```

The `titled` text becomes the gray placeholder hint. More props:
`placeholder`, `width`, `height`, `enabled`, `visible`, `password`,
`font`, `font_size`.

```vxl
create a window titled "My App"

secret = add an input box
secret.password = true
```

## 5. Output boxes

Output boxes show application text (read-only, scrollable):

```vxl
create a window titled "My App"

output = add an output box

output.text = "Application started."

output.clear

window.show
```

## 6. Images

```vxl
create a window titled "My App"

logo = add an image "logo.png"

logo.width = 200
logo.height = 150

logo.source = "new_logo.png"

window.show
```

A missing file is a catchable runtime error:

```vxl
create a window titled "My App"

logo = add an image "logo.png"

try {
    logo.source = "nope.png"
} error {
    print error
}
```

## 7. Checkboxes

```vxl
create a window titled "My App"

remember = add a checkbox titled "Remember me"

if remember.checked {
    print "Remember enabled"
}

remember.on change {
    print remember.checked
}

window.show
```

## 8. Sliders

```vxl
create a window titled "My App"

volume = add a slider
volume.minimum = 0
volume.maximum = 100
volume.step = 5
volume.value = 50

volume.on change {
    print volume.value
}

window.show
```

Setting a value outside minimum/maximum is a catchable runtime
error.

## 9. Progress bars

```vxl
create a window titled "My App"

progress = add a progress bar
progress.minimum = 0
progress.maximum = 100
progress.value = 50

window.show
```

## 10. Dropdowns

```vxl
create a window titled "My App"

choice = add a dropdown
choice.add "Rock"
choice.add "Paper"
choice.add "Scissors"

choice.on change {
    print choice.selected
}

window.show
```

Read `choice.selected` (text) or `choice.selected_index` (integer,
-1 means nothing selected). Both are also settable.

## 11. Lists

```vxl
create a window titled "My App"

items = add a list
items.add "Apple"
items.add "Banana"
items.add "Orange"
items.remove 0

window.show
```

## 12. Containers

Group widgets so they lay out together:

```vxl
create a window titled "My App"

container = create a container

add a button titled "Start" to container
add a button titled "Settings" to container

add container to window

window.show
```

Container types (pick the layout behavior you want):

```vxl
create a window titled "My App"

row = create a horizontal container
column = create a vertical container
grid = create a grid container
scrollable = create a scroll container
```

## 13. Layouts

Widgets flow top-down automatically — no x/y needed. For control:

```vxl
create a window titled "My App"

button = add a button titled "Click Me"

center button
center button in window

window.show
```

Containers take spacing, padding, and alignment:

```vxl
create a window titled "My App"

column = create a vertical container
set column spacing to 10
set column padding to 20
set column alignment to center
```

Alignment values: `left`, `center`, `right`, `top`, `middle`,
`bottom`.

Responsive sizes with percentages and fill:

```vxl
create a window titled "My App"

button = add a button titled "Go"

set button width to 50 percent
set button height to fill
set window min width to 300
```

Percent widths track the parent when the window is resized.

## 14. Styling

```vxl
create a window titled "My App"

button = add a button titled "Go"

button.background = "blue"
button.text_color = "white"
button.font_size = 18
button.border_radius = 10
```

Colors are names (`blue`, `white`) or hex (`#FF0000`). Unknown
colors are compile-time errors when written literally. Also
available: `font`, `bold`, `italic`, `opacity` (window only),
`border`, `border_width`, `padding`, `margin`.

Themes recolor the whole window at once:

```vxl
create a window titled "My App"

use theme "dark"
use theme "light"
```

Custom themes (same three core styles, more later):

```vxl
theme Mono {
    background = "black"
    text_color = "white"
    font_size = 16
}

create a window titled "My App"

use theme "Mono"

window.show
```

## 15. Events

Handlers are plain Vexel blocks with full access to your variables:

```vxl
create a window titled "Counter"

count = 0
label = add a text titled "Count: 0"
button = add a button titled "Increase"

button.on click {
    count = count + 1
    label.text = "Count: " + count
}

window.show
```

Mouse events: `click`, `press`, `release`, `hover`, `enter`,
`leave`. Change events: `input.on change`, `volume.on change`,
`choice.on change`. Keyboard:

```vxl
create a window titled "Keys"

window.on key press {
    print key
}
```

Inside a key handler, `key` holds the pressed key name (e.g.
`Enter`, `A`, `F5`). Using `key` anywhere else is a compile-time
error. Handlers cannot use `return`.

## 16. Dialogs

```vxl
create a window titled "My App"

show a message "Hello!"
show a warning "Something went wrong!"

answer = ask "Are you sure?"

if answer {
    print "Confirmed"
}

window.show
```

File and color pickers return strings (empty when cancelled —
check before using):

```vxl
create a window titled "My App"

button = add a button titled "Paint"

file = choose a file

if file = "" {
    print "Cancelled"
} else {
    print file
}

color = choose a color

if color = "" {
    print "Cancelled"
} else {
    button.background = color
}
```

## 17. Menus

```vxl
create a window titled "My App"

menu = add a menu titled "File"

openItem = menu.add "Open"
saveItem = menu.add "Save"

openItem.on click {
    print "Open clicked"
}

window.show
```

## 18. Tabs

```vxl
create a window titled "My App"

tabs = add a tab bar

home = tabs.add "Home"
settings = tabs.add "Settings"

welcome = add a text titled "Hi" to home
option = add a checkbox titled "Sound" to settings

window.show
```

## 19. Animations

Animations never block the app:

```vxl
create a window titled "My App"

button = add a button titled "Slide"

animate button {
    move to x 500
    duration 1 second
}

window.show
```

Fade the window (controls cannot fade on this backend — the
compiler will tell you):

```vxl
create a window titled "My App"

fade window
    duration 0.5 seconds

window.show
```

Steps: `move to x|y`, `size to W, H`, `fade to 0..1` (window),
`duration N second(s)`.

## 20. Custom components

Bundle widgets into a reusable block, then stamp it out:

```vxl
create a window titled "My App"

component login_box {
    add a text titled "Login"
    add an input box
    add a button titled "Login"
}

add login_box
add login_box

window.show
```

Components may contain event handlers but no `return`, and they
cannot create windows.

## More widgets

Toolbar with clickable buttons:

```vxl
create a window titled "My App"

toolbar = add a toolbar
save = toolbar.add a button titled "Save"

save.on click {
    print "Saved"
}
```

Table with columns and rows:

```vxl
create a window titled "My App"

table = add a table
table.add column "Name"
table.add column "Age"
table.add row ["Zen", 25]
table.add row ["Alex", 30]
```

Tree with nested nodes:

```vxl
create a window titled "My App"

tree = add a tree
folder = tree.add "Projects"
folder.add "Vexel"
folder.add "Games"
```

Spinner for loading moments:

```vxl
create a window titled "My App"

spinner = add a spinner
spinner.visible = true
spinner.visible = false
```

## Vexel 2.2 notes

Coordinates are exact client-area pixels: `x`/`y` place a control
relative to its parent (window or container), never cumulative
across siblings, and the default root panel adds no padding.
DPI scaling happens once inside the backend.

Window extras:

```vxl
create a window titled "My App"

window.minimize
window.restore
window.maximize
window.hide

window.on resize {
    print "Window resized"
}

window.on close {
    print "Goodbye"
}

window.show
```

Cancellable timers return handles:

```vxl
create a window titled "My App"

ticker = every 1 second {
    print "tick"
}

ticker.cancel

window.show
```

See `docs/runtime.md` for the coordinate system, lifecycle,
shutdown rules, and `vexel debug` geometry validation.
