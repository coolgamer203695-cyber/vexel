/* Vexel course lessons 13-22 — Level 2: Logic. */
(function () {
  "use strict";
  var L = (globalThis.LESSONS = globalThis.LESSONS || []);

  L.push({ n: 13, title: "Comparisons", level: "Logic",
    intro: "Comparisons ask a yes/no question about two values and answer with a boolean. Vexel offers ==, !=, >, <, >= and <=. Inside expressions and conditions, a single = also means equality, so if age = 18 reads naturally.",
    syntax: ["height = 190", "tall = height > 180", "name = \"Zen\"", "same = name == \"Zen\"", "level = 12", "ready = level >= 10"],
    points: [
      "== and = both test equality; != tests inequality.",
      ">, <, >=, <= compare numbers (and strings by order).",
      "The result is always a boolean you can print, store or test."
    ],
    examples: [
      { code: 'age = 20\nprint age >= 18\nprint age == 20\nprint age != 21', note: "Three questions, three booleans: true, true, true.", check: "pass" },
      { code: 'name = "Zen"\nprint name == "Zen"\nscore = 99\nprint score < 100', note: "Comparisons work on strings too. Both print true.", check: "pass" }
    ],
    mistakes: [
      { code: 'if age { print "hi" }', why: "A bare number is not a question. Conditions need a comparison or boolean: if age >= 13.", check: "fail" }
    ],
    exercise: "Store a password string and a guess string. Print whether they are equal with ==." });

  L.push({ n: 14, title: "if", level: "Logic",
    intro: "if runs a block only when its condition is true. Write the question, open a block with {, put the statements inside, and close with }. Everything between the braces is skipped when the condition is false.",
    syntax: ["age = 20", "if age >= 18 {", '    print "Adult"', "}"],
    points: [
      "The condition is checked first; the block runs only on true.",
      "Blocks use curly braces, and statements sit on their own lines.",
      "if never needs parentheses around the condition."
    ],
    examples: [
      { code: 'age = 20\nif age >= 18 {\n    print "Adult"\n}', note: "20 is 18 or more, so Adult prints.", check: "pass" },
      { code: 'hp = 0\nif hp <= 0 {\n    print "Game over"\n    print "Try again?"\n}', note: "A block can hold many statements. Both lines print.", check: "pass" }
    ],
    mistakes: [
      { code: 'if age >= 18\n    print "Adult"', why: "The braces are mandatory. Without { }, Vexel does not know where the block starts.", check: "fail" }
    ],
    exercise: "Ask whether a score of 95 reaches a goal of 100: print Reached! only if score >= 100." });

  L.push({ n: 15, title: "else", level: "Logic",
    intro: "else is the fallback for if: when the condition is false, the else block runs instead. Together they cover both outcomes, so exactly one of the two blocks always runs.",
    syntax: ["age = 14", "if age >= 18 {", '    print "Adult"', "} else {", '    print "Minor"', "}"],
    points: [
      "else attaches directly to the closing } of the if block.",
      "Exactly one branch runs — never both, never neither.",
      "else takes no condition of its own."
    ],
    examples: [
      { code: 'age = 14\nif age >= 18 {\n    print "Adult"\n} else {\n    print "Minor"\n}', note: "14 is below 18, so the else branch prints Minor.", check: "pass" },
      { code: 'loggedIn = false\nif loggedIn {\n    print "Welcome back"\n} else {\n    print "Please log in"\n}', note: "Booleans slot straight into if. The else branch runs here.", check: "pass" }
    ],
    mistakes: [
      { code: 'if age >= 18 {\n    print "Adult"\n}\nelse {\n    print "Minor"\n}', why: "else must sit on the same line as the closing brace: } else {. A newline before else breaks the chain.", check: "fail" }
    ],
    exercise: "A shop gives free shipping for orders of 50 or more. Print Free shipping or Add more items using if/else." });

  L.push({ n: 16, title: "else if", level: "Logic",
    intro: "else if chains extra questions between if and else. Vexel checks each condition top to bottom and runs the first branch whose condition is true. A final else catches everything left over.",
    syntax: ["age = 15", "if age >= 18 {", '    print "Adult"', "} else if age >= 13 {", '    print "Teenager"', "} else {", '    print "Child"', "}"],
    points: [
      "Order matters: put the most specific or highest check first.",
      "Only the first true branch runs; the rest are skipped.",
      "End with else to handle all remaining cases."
    ],
    examples: [
      { code: 'age = 15\nif age >= 18 {\n    print "Adult"\n} else if age >= 13 {\n    print "Teenager"\n} else {\n    print "Child"\n}', note: "15 fails the first test, passes the second: Teenager.", check: "pass" },
      { code: 'score = 92\nif score >= 90 {\n    print "A"\n} else if score >= 80 {\n    print "B"\n} else {\n    print "C"\n}', note: "Grade bands are a classic else-if chain. This prints A.", check: "pass" }
    ],
    mistakes: [
      { code: 'age = 20\nif age >= 13 {\n    print "Teenager"\n} else if age >= 18 {\n    print "Adult"\n}', why: "Wrong order: 20 matches >= 13 first and never reaches the Adult branch. Test 18 before 13.", check: "pass" }
    ],
    exercise: "Classify temperature: Hot at 30+, Warm at 20+, Cool at 10+, otherwise Cold. Test with 25." });

  L.push({ n: 17, title: "Logical Operators", level: "Logic",
    intro: "Logical operators combine booleans into bigger questions. Vexel spells them in English: and, or, not. Comparisons bind tighter than all three, and not binds tighter than and, which binds tighter than or.",
    syntax: ["age = 20", "ready = true", "if age >= 18 and ready {", '    print "Allowed"', "}"],
    points: [
      "and is true only when both sides are true.",
      "or is true when at least one side is true.",
      "not flips a boolean: not ready means ready is false.",
      "Precedence: comparisons first, then not, then and, then or."
    ],
    examples: [
      { code: 'age = 20\nready = true\nif age >= 18 and ready {\n    print "Allowed"\n}', note: "Both sides true, so Allowed prints.", check: "pass" },
      { code: 'vip = false\ncoupon = true\nif vip or coupon {\n    print "Discount!"\n}', note: "One true side is enough for or. Discount! prints.", check: "pass" }
    ],
    mistakes: [
      { code: 'if age >= 18 && ready { print "x" }', why: "Vexel has no && or || symbols. Spell them out: and, or, not.", check: "fail" }
    ],
    exercise: "A ride needs height >= 120 and (ticket or pass). Set variables and print Can ride only when allowed." });

  L.push({ n: 18, title: "not", level: "Logic",
    intro: "not reverses a boolean: not true is false, not false is true. It reads naturally in guards — if not ready means do this while we are not ready — and it binds tighter than and and or.",
    syntax: ["ready = false", "if not ready {", '    print "Waiting..."', "}"],
    points: [
      "not applies to the boolean (or comparison) right after it.",
      "Use it to test the negative case without an else.",
      "Double negatives (not not ready) are legal but hard to read — avoid them."
    ],
    examples: [
      { code: 'ready = false\nif not ready {\n    print "Waiting..."\n}', note: "ready is false, so not ready is true. Waiting... prints.", check: "pass" },
      { code: 'hp = 30\nif not hp <= 0 {\n    print "Still alive"\n}', note: "not applies to the whole comparison: hp is not <= 0, so this prints.", check: "pass" }
    ],
    mistakes: [
      { code: 'if !ready { print "x" }', why: "There is no ! operator in Vexel. Write not ready.", check: "fail" }
    ],
    exercise: "A door starts closed (open = false). Print Door is shut only when not open, then set open to true and print Door is open." });

  L.push({ n: 19, title: "and", level: "Logic",
    intro: "and demands everything: the whole condition is true only if the left side and the right side are both true. Chain more with additional ands. It is the tool for checklists where every item must pass.",
    syntax: ["hasTicket = true", "hasId = true", "if hasTicket and hasId {", '    print "Enter"', "}"],
    points: [
      "Both sides must be true — one false side makes the result false.",
      "Comparisons are evaluated before and, so age >= 18 and ready parses as (age >= 18) and ready.",
      "Use and for requirements, or for alternatives."
    ],
    examples: [
      { code: 'hasTicket = true\nhasId = true\nif hasTicket and hasId {\n    print "Enter"\n}', note: "Both true: Enter prints.", check: "pass" },
      { code: 'level = 12\nhasKey = false\nif level >= 10 and hasKey {\n    print "Door opens"\n} else {\n    print "Locked"\n}', note: "One side false, so the whole and is false: Locked.", check: "pass" }
    ],
    mistakes: [
      { code: 'if hasTicket & hasId { print "x" }', why: "A single & is not Vexel. The word is and.", check: "fail" }
    ],
    exercise: "A spell needs mana >= 10 and known == true. Test two cases: one where it casts, one where it fizzles." });

  L.push({ n: 20, title: "or", level: "Logic",
    intro: "or is the lenient operator: the condition is true when the left side, the right side, or both are true. Only false or false gives false. Reach for or when any one of several options is acceptable.",
    syntax: ["isWeekend = false", "isHoliday = true", "if isWeekend or isHoliday {", '    print "No work!"', "}"],
    points: [
      "At least one true side makes or true.",
      "or binds looser than and — mix them with parentheses for clarity.",
      "Pair or with else to handle the all-false case."
    ],
    examples: [
      { code: 'isWeekend = false\nisHoliday = true\nif isWeekend or isHoliday {\n    print "No work!"\n}', note: "One true side is enough: No work! prints.", check: "pass" },
      { code: 'role = "guest"\nif role == "admin" or role == "mod" {\n    print "Power user"\n} else {\n    print "Regular user"\n}', note: "guest matches neither, so the else branch prints.", check: "pass" }
    ],
    mistakes: [
      { code: 'if role == "admin" or "mod" { print "x" }', why: "Each side of or must be a full condition. Write role == \"admin\" or role == \"mod\".", check: "fail" }
    ],
    exercise: "A pet is happy if fed or playedWith. Try all four true/false combinations and print the result each time." });

  L.push({ n: 21, title: "Nested Conditions", level: "Logic",
    intro: "Conditions can live inside other conditions. The outer if picks a group, the inner if picks within it. Nesting keeps each question small and readable — but more than two levels usually wants a function instead.",
    syntax: ["loggedIn = true", "admin = true", "if loggedIn {", "    if admin {", '        print "Admin panel"', "    }", "}"],
    points: [
      "Inner blocks run only when every outer condition is true.",
      "Indent each level so the structure is visible.",
      "Flatten with and when the inner test needs no else of its own."
    ],
    examples: [
      { code: 'loggedIn = true\nadmin = true\nif loggedIn {\n    if admin {\n        print "Admin panel"\n    } else {\n        print "Dashboard"\n    }\n}', note: "Both true: Admin panel. Flip admin to false and Dashboard prints.", check: "pass" },
      { code: 'age = 20\nmember = true\nif age >= 18 {\n    if member {\n        print "Member price"\n    } else {\n        print "Full price"\n    }\n}', note: "Outer picks adults; inner picks the price. Member price prints.", check: "pass" }
    ],
    mistakes: [
      { code: 'loggedIn = true\nadmin = true\nif loggedIn {\nif admin {\nprint "Hi"\n}\n}', why: "Legal, but unreadable. Indent nested blocks so humans can follow the levels.", check: "pass" }
    ],
    exercise: "If it is raining, check wind too: print Storm! when windy, else Light rain. When not raining, print Clear skies." });

  L.push({ n: 22, title: "Building a Decision System", level: "Logic",
    intro: "Time to combine everything from this level: comparisons, if/else-if/else, and, or and not. A small decision system reads inputs as variables, walks a chain of rules, and prints exactly one verdict.",
    syntax: ["score = 95", "bonus = true", "if score >= 90 and bonus {", '    print "S rank"', "}"],
    points: [
      "List the rules first as comments, then encode them top-down.",
      "Most specific rule goes first; the final else is the default.",
      "One verdict per run keeps the system predictable."
    ],
    examples: [
      { code: '// Rank a quest result\nscore = 85\nbonus = true\nif score >= 90 and bonus {\n    print "S rank"\n} else if score >= 80 {\n    print "A rank"\n} else if score >= 60 {\n    print "B rank"\n} else {\n    print "C rank"\n}', note: "85 with no S-rule match lands on A rank. Change score to 95 to see S rank.", check: "pass" },
      { code: 'weather = "rain"\nwind = false\nif weather == "storm" or (weather == "rain" and wind) {\n    print "Stay inside"\n} else {\n    print "Go outside"\n}', note: "Parentheses group the and inside the or. This prints Go outside.", check: "pass" }
    ],
    mistakes: [
      { code: 'score = 85\nif score >= 60 {\n    print "B rank"\n} else if score >= 80 {\n    print "A rank"\n}', why: "Low thresholds first swallow the high ones: 85 prints B rank and never reaches A. Order high to low.", check: "pass" }
    ],
    exercise: "Build a movie recommender: variables age and likesScary. Kids get Cartoons, teens who like scary get Horror, other teens get Adventure, adults get Drama." });
})();
if (typeof module !== "undefined") module.exports = globalThis.LESSONS;
