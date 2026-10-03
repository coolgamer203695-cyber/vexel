/* Vexel course lessons 1-12 — Level 1: Getting Started. Real content, checked examples. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 1, title: "What is Vexel?", level: "Getting Started",
    intro: "Vexel is a general-purpose programming language designed to stay simple. It uses readable English-like words, infers your types automatically, checks them strictly, and compiles your program into a native executable. The same language also builds real desktop apps with windows, buttons and events.",
    syntax: [],
    points: [
      "Vexel source files end with .vxl.",
      "You run a program with vexel hello.vxl.",
      "Vexel is compiled: vexel build makes a native executable instead of interpreting your file.",
      "Vexel has its own philosophy — readable, typed, compiled, UI-capable — and is not a clone of any other language."
    ],
    examples: [
      { code: 'print "Hello World!"', note: "The classic first program. print shows text on the screen.", check: "pass" },
      { code: 'print "Vexel 2.2.0"\nprint "Build. Compile. Create."', note: "A program can hold many statements, one per line.", check: "pass" }
    ],
    mistakes: [
      { code: 'Print "Hello"', why: "Keywords are lowercase. Print with a capital P is not the same word and will not compile." }
    ],
    exercise: "Write down in your own words what makes Vexel different: readable syntax, inferred types, compiled executables, built-in desktop UI." });

  L.push({ n: 2, title: "Installing Vexel", level: "Getting Started",
    intro: "To use Vexel you need Node.js version 18 or newer plus the native compiler toolchain described on the download page. There is nothing to install with npm — Vexel has zero dependencies.",
    syntax: [],
    points: [
      "Check Node.js with node --version (must be 18 or newer).",
      "Check the native compiler toolchain with the steps on the download page.",
      "Open the Vexel folder and run the compiler with node bin/vexel.js --help, or put Vexel on your PATH.",
      "On Windows you can use vexel.cmd; on Linux and macOS use ./vexel."
    ],
    examples: [
      { code: "node --version", note: "Verifies your Node.js install. You should see version 18 or newer.", lang: "bash" },
      { code: "vexel version", note: "Asks Vexel itself for its version. You should see Vexel 2.2.0.", lang: "bash" }
    ],
    mistakes: [
      { code: "vexel", why: "Running vexel with no arguments and no program shows help, but does not run anything. Give it a file: vexel hello.vxl.", lang: "bash" }
    ],
    exercise: "Run node --version and vexel version on your machine and confirm each one prints a version number." });

  L.push({ n: 3, title: "Your First Vexel Program", level: "Getting Started",
    intro: "A Vexel program is a plain text file ending in .vxl. The simplest program is one line that prints text. Create the file, type the line exactly, save it, and you are ready to run it in the next lesson.",
    syntax: ['print "Hello World!"'],
    points: [
      "Create a file named hello.vxl.",
      "Put exactly one statement in it: print followed by text in double quotes.",
      "Save the file. That is a complete Vexel program."
    ],
    examples: [
      { code: 'print "Hello World!"', note: "Prints Hello World! when the program runs.", check: "pass" },
      { code: 'print "I am learning Vexel!"', note: "Any text in double quotes works. Make it your own.", check: "pass" }
    ],
    mistakes: [
      { code: 'print Hello World!', why: "Text must be wrapped in double quotes. Without quotes, Vexel reads Hello as a variable name and fails." }
    ],
    exercise: "Create hello.vxl with a greeting that includes your name, for example print \"Hello, I am Sam!\"." });

  L.push({ n: 4, title: "Running a .vxl File", level: "Getting Started",
    intro: "Vexel compiles your program to a native executable and runs it. The normal workflow is: vexel file.vxl to compile and run in one step, vexel build file.vxl to keep the executable, and vexel check file.vxl to only verify types without building.",
    syntax: [],
    points: [
      "vexel hello.vxl compiles hello.vxl to a temporary native program and runs it.",
      "vexel build hello.vxl keeps the executable next to your source (hello.exe on Windows).",
      "vexel check hello.vxl type-checks only — fast feedback with no build.",
      "vexel run hello.vxl is the explicit form of compile-and-run."
    ],
    examples: [
      { code: "vexel hello.vxl", note: "Compile and run hello.vxl in one step.", lang: "bash" },
      { code: "vexel check hello.vxl\nvexel build hello.vxl", note: "First verify types, then produce the native executable.", lang: "bash" }
    ],
    mistakes: [
      { code: "vexel hello", why: "The .vxl extension matters. vexel hello will not find your program — write vexel hello.vxl.", lang: "bash" }
    ],
    exercise: "Run your hello.vxl three ways: vexel hello.vxl, vexel check hello.vxl, and vexel build hello.vxl. Run the built executable directly." });

  L.push({ n: 5, title: "print", level: "Getting Started",
    intro: "print shows a value on the screen. Give it text in quotes, a variable, or an expression. Each print writes one line. In desktop UI apps, print still writes to the terminal, which makes it handy for debugging buttons and events.",
    syntax: ['name = "Zen"', 'age = 25', 'print "Hello World!"', "print name", 'print "Age: " + age'],
    points: [
      "print with quoted text shows exactly that text.",
      "print with a variable shows the variable's value.",
      "print with + joins text and values into one line."
    ],
    examples: [
      { code: 'print "Hello World!"\nprint "Learning Vexel is fun!"', note: "Two prints produce two lines of output.", check: "pass" },
      { code: 'name = "Zen"\nprint name\nprint "Hello " + name', note: "print works with variables, and + glues text and variables together.", check: "pass" },
      { code: 'age = 25\nprint "Age: " + age', note: "Numbers join with text automatically — no conversion needed.", check: "pass" }
    ],
    mistakes: [
      { code: 'print "Score: " + score', why: "score was never created. Every variable must be assigned before print can use it." }
    ],
    exercise: "Print three lines: your name, your favorite color, and one line that joins text with a number, like print \"Level: \" + level." });

  L.push({ n: 6, title: "Comments", level: "Getting Started",
    intro: "Comments are notes for humans that Vexel ignores. Start a comment with // and it runs to the end of the line. Use comments to explain why code exists, not to repeat what it obviously does.",
    syntax: ["// This is a comment", 'print "hi" // trailing comment'],
    points: [
      "// starts a comment anywhere on a line.",
      "A full-line comment explains the code below it.",
      "A trailing comment explains the line it sits on."
    ],
    examples: [
      { code: '// Greet the player\nprint "Welcome!"', note: "The comment is ignored; only Welcome! prints.", check: "pass" },
      { code: 'print "hi" // say hi to the user', note: "Trailing comments share a line with real code.", check: "pass" }
    ],
    mistakes: [
      { code: '# Say hello\nprint "Hi"', why: "Only // starts a comment. # is not a comment marker and fails with an unexpected-character error.", check: "fail" }
    ],
    exercise: "Take your hello.vxl and add two comments: one full-line comment at the top saying what the program does, and one trailing comment." });

  L.push({ n: 7, title: "Variables", level: "Getting Started",
    intro: "A variable is a named box that holds a value. In Vexel you create one by assigning with = — there is no let, var or const. The name should say what the value means.",
    syntax: ['name = "Zen"', "age = 25", "ready = true", "price = 19.99"],
    points: [
      "name = value creates the variable (or updates it).",
      "Names use letters, digits and underscores, and must not start with a digit.",
      "Some words are reserved (print, if, function, null, r, output, error) and cannot be variable names."
    ],
    examples: [
      { code: 'name = "Zen"\nage = 25\nprint name\nprint age', note: "Two variables, two prints. Assignment first, use after.", check: "pass" },
      { code: 'score = 0\nprint score\nscore = 10\nprint score', note: "Assigning again updates the value. The second print shows 10.", check: "pass" }
    ],
    mistakes: [
      { code: 'print score\nscore = 5', why: "Use before assignment fails. Create the variable before you print it." }
    ],
    exercise: "Create three variables — your name, your age and whether you are ready (true/false) — and print all three." });

  L.push({ n: 8, title: "Automatic Type Inference", level: "Getting Started",
    intro: "Every Vexel value has a type: integer, decimal, boolean or string. You never declare types — Vexel infers them from your assignments. After inference, checking is strict: putting the wrong kind of value into a variable is a compile-time error, caught before your program runs.",
    syntax: ['name = "Zen"', "age = 25"],
    points: [
      "Text in quotes is a string, whole numbers are integers, numbers with a point are decimals, true/false are booleans.",
      "Vexel figures out each type automatically.",
      "Reassigning a variable with a different type fails the build with a TypeError."
    ],
    examples: [
      { code: 'name = "Zen"\nage = 25\nready = true\nprice = 19.99\nprint name\nprint age', note: "Four variables, four inferred types: string, integer, boolean, decimal.", check: "pass" },
      { code: 'level = 1\nlevel = 2\nprint level', note: "Same-type reassignment is fine. level stays an integer.", check: "pass" }
    ],
    mistakes: [
      { code: 'age = 25\nage = "old"', why: "TypeError at compile time: age was inferred as integer and cannot later hold a string.", check: "fail" }
    ],
    exercise: "Declare one variable of each type. Then try changing one to a different type and run vexel check to see the TypeError — then change it back." });

  L.push({ n: 9, title: "Numbers", level: "Getting Started",
    intro: "Vexel has two number types. Whole numbers like 25 are integers; numbers with a fractional part like 19.99 are decimals. Dividing integers produces a decimal, which keeps results honest.",
    syntax: ["score = 100", "price = 19.99", "half = 7 / 2"],
    points: [
      "Integers: ..., -2, -1, 0, 1, 2, ... (write them plainly).",
      "Decimals: any number with a point, like 3.5.",
      "/ on integers yields a decimal: 7 / 2 is 3.5.",
      "% (remainder) needs integers on both sides."
    ],
    examples: [
      { code: 'score = 100\nprice = 19.99\nprint score\nprint price', note: "An integer and a decimal side by side.", check: "pass" },
      { code: 'half = 7 / 2\nprint half', note: "Store the division in a variable first, then print. This prints 3.5.", check: "pass" },
      { code: 'left = 10 % 3\nprint left', note: "% gives the remainder. 10 divided by 3 leaves 1.", check: "pass" }
    ],
    mistakes: [
      { code: 'total = 10\ncount = 2\nprint total / count', why: "Two names around / read as the file path total/count — this fails at runtime with File not found. Compute first: half = total / count, then print half.", check: "pass" }
    ],
    exercise: "Compute 100 / 4 into a variable and print it. Then compute 17 % 5 and print the remainder." });

  L.push({ n: 10, title: "Strings", level: "Getting Started",
    intro: "Strings are text in double quotes. Join them with +: string + anything converts the other side to text automatically. This makes building messages, labels and UI text effortless.",
    syntax: ['name = "Zen"', 'greeting = "Hello " + name', 'level = 10', 'print "Level: " + level'],
    points: [
      "Double quotes make a string.",
      "+ joins strings together (concatenation).",
      "string + integer/decimal/boolean converts the value to text."
    ],
    examples: [
      { code: 'first = "Ada"\nlast = "Lovelace"\nfull = first + " " + last\nprint full', note: "Joining with a space in the middle gives Ada Lovelace.", check: "pass" },
      { code: 'level = 10\nprint "Level: " + level\nready = true\nprint "Ready: " + ready', note: "Numbers and booleans convert to text inside +.", check: "pass" }
    ],
    mistakes: [
      { code: 'print "Unfinished greeting', why: "The closing quote is missing. Every string needs an opening and a closing double quote.", check: "fail" }
    ],
    exercise: "Build a greeting from two variables (first and last name) plus an exclamation mark, and print it on one line." });

  L.push({ n: 11, title: "Booleans", level: "Getting Started",
    intro: "A boolean is either true or false. Booleans record yes/no facts — is the player ready, is the door open — and they drive if conditions and loops later. Print them to see their value while learning.",
    syntax: ["ready = true", "doorOpen = false"],
    points: [
      "Only two boolean values exist: true and false (lowercase).",
      "Booleans usually come from comparisons (age >= 18) or start as flags you set yourself.",
      "true + text converts to text, like other values."
    ],
    examples: [
      { code: 'ready = true\nprint ready\ndoorOpen = false\nprint doorOpen', note: "Two flags, two prints: true then false.", check: "pass" },
      { code: 'age = 20\nadult = age >= 18\nprint adult', note: "A comparison produces a boolean. adult is true here.", check: "pass" }
    ],
    mistakes: [
      { code: 'ready = True', why: "Capitalized True is a different word, not the boolean. Vexel booleans are lowercase: true and false.", check: "fail" }
    ],
    exercise: "Create two boolean flags for a game (for example soundOn and hardMode), print both, then flip one to the other value and print again." });

  L.push({ n: 12, title: "Basic Math", level: "Getting Started",
    intro: "Vexel does arithmetic with + - * / %. Multiplication, division and remainder bind tighter than addition and subtraction; parentheses override everything. Compute first, print after — especially with division.",
    syntax: ["price = 20", "total = price * 3", "a = 10", "b = 20", "avg = (a + b) / 2"],
    points: [
      "Precedence: parentheses, then * / %, then + -.",
      "Use parentheses to say exactly what you mean.",
      "Never divide inside print — a slash there means a file path. Use a variable."
    ],
    examples: [
      { code: 'total = 3 + 4 * 2\nprint total', note: "Multiplication first: 4 * 2 is 8, plus 3 is 11.", check: "pass" },
      { code: 'avg = (10 + 20) / 2\nprint avg', note: "Parentheses first: 30 / 2. avg is the decimal 15.", check: "pass" },
      { code: 'price = 19\ntaxed = price + price * 2 / 10\nprint taxed', note: "A longer expression, still one statement. taxed prints 22.8.", check: "pass" }
    ],
    mistakes: [
      { code: 'print (10 + 20 / 2', why: "The closing parenthesis is missing. Unbalanced parentheses never compile — count them.", check: "fail" }
    ],
    exercise: "A game gives 3 quests worth 150, 200 and 250 points. Compute the total and the average (total / 3) into variables and print both." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
