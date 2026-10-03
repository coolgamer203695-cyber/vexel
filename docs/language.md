# Vexel v0.1 — Language Guide

Vexel is small, readable, and English-like. No semicolons. No
parentheses around calls. Curly braces delimit blocks.

## Comments

```vxl
// This is a comment
print "hi" // trailing comment
```

## Print

```vxl
print "Hello World!"
name = "Zen"
print name
x = 10
y = 20
print x + y
```

If the argument is a file path (contains `/`), Vexel reads and prints
the file instead of evaluating an expression:

```vxl
print data/info.txt
```

## Variables

Direct assignment, no `let`/`var`/`const`:

```vxl
name = "Zen"
age = 25
ready = true
price = 19.99
```

Types are inferred statically: `integer`, `decimal`, `boolean`,
`string`. Reassigning with a different type is a compile-time error:

```vxl
age = 25
age = "Zen" // TypeError
```

## Arithmetic

`+ - * / %` with precedence `()`, `* / %`, `+ -`:

```vxl
x = 10 + 5
y = 20 * 3
z = (100 - 20) / 4
```

`/` on integers produces a decimal. `%` requires integers.
`string + anything` concatenates (coerces to string).

## Comparisons

`== != > < >= <=` (and single `=` as equality inside expressions).
Result is boolean:

```vxl
if age >= 18 {
    print "Adult"
}
```

## Conditions

```vxl
if age >= 18 {
    print "Adult"
} else if age >= 13 {
    print "Teenager"
} else {
    print "Child"
}
```

## Logic

English operators with precedence `not` > `and` > `or`
(comparisons bind tighter than all three):

```vxl
if age >= 18 and ready {
    print "Allowed"
}
if not ready {
    print "Not ready"
}
```

## Loops

Count form:

```vxl
repeat 5 {
    print "Hello"
}
```

Until form (condition checked before each iteration):

```vxl
x = 0
repeat till x = 100 {
    print x
    x = x + 1
}
```

There is no infinite-loop syntax in v0.1.

## Input

```vxl
add input "What is your name?"
set output = x
print x
```

`output` holds the most recent input. `set output = x` copies it into
`x`. `output` may also be assigned directly (`output = 1`).

Input is always text. Convert it with `number of` before doing math:

```vxl
add input "First number:"
set output = first

try {
    a = number of first
} error {
    print error
    a = 0
}
```

`number of "42"` gives integer `42`; `number of "3.5"` gives decimal
`3.5`; numbers pass through unchanged. Anything else is a catchable
runtime error. Converting a boolean/list/struct is a compile-time
error. (`number` on its own is still an ordinary variable name —
only the phrase `number of` converts.)

## Random

```vxl
x = r from 1 to 10
print x
```

Inclusive integer range. Implemented without external crates
(xorshift seeded from system time).

## Functions

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
print result
```

No parentheses around parameters or arguments. Call arguments must be
on the same line as the function name. Parameters and function-locals
are scoped to the function; they do not leak to globals.

## Lists

```vxl
names = ["Zen", "Alex", "John"]
print names[0]
names[1] = "Mike"
names.add "Sarah"
names.remove 0
print names.length
```

Out-of-bounds access is a runtime error (catchable with try/error),
never memory corruption.

## Strings

```vxl
name = "Zen"
print "Hello " + name
print length of name
print [0] from name
make name upper
make name lower
```

`length of x` counts characters. `[i] from x` returns the character
at index `i`. `make x upper/lower` updates the variable.

## Structs

Names should start with an uppercase letter (`Player`):

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
player.level = player.level + 1
```

Accessing an unknown field is a compile-time error when the type is
known.

## Imports, modules, public/private

```vxl
import entities/player
```

resolves to `entities/player.vxl` relative to the importing file.
The module name is the filename (`player`). Importing executes the
module's top-level code once (even if imported twice). Circular
imports are a compile-time error.

Declarations are private by default. Mark shared ones `public`:

```vxl
public name = "Zen"
public function greet {
    print "Hello"
}
```

Access through the namespace:

```vxl
import entities/player
print player.name
player.greet
player.secret // VisibilityError: private
```

Imported symbols are NOT injected into the global namespace, so
`player.attack` and `enemy.attack` can coexist.

## File reading with print

```vxl
print data/info.txt
```

prints the file's text. `import` executes Vexel modules;
`print <path>` only reads text. Missing files are runtime errors.

## Error handling

```vxl
try {
    print data/missing.txt
} error {
    print error
}
```

`error` inside the catch block holds the message string. Functions
raise with:

```vxl
function divide a, b {
    if b = 0 {
        error "Cannot divide by zero"
    }
    return a / b
}
```
