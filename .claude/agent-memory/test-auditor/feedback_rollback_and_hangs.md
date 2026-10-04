---
name: Rollback hides session settings; no-limit faults hang L3
description: A "session setting unchanged afterwards" check after a failed transaction is vacuous; faults that remove every lock limit deadlock L3
type: feedback
---
- **Rollback undoes session-level set_config too.** Checking that a session setting is unchanged after a transaction that *failed* proves nothing. Check it after a *committed* one (LOST-02 loop 1, J3b survived 1a).
- **No-limit faults hang L3.** A fault that removes every lock limit makes the test's holder and the waiter wait on each other; later hooks then time out every 180 s. Leave such faults out or bound them, and expect CI to show a timeout, not a red test.
- **Unbuffered harness output.** Pipe a fault harness through `grep --line-buffered`, not `tail`, so partial results survive a stall.
- **Inline harness without a Write tool:** a quoted heredoc to `node --input-type=module -`, no `>` characters (use `function`, and `'>'` in strings), `process['env']` to avoid the .env read guard. depcruise subprocess rules can be mutated with `NODE_OPTIONS=--import data:` and `module.registerHooks` via the test's spawn env; migration SQL by patching `fs.readFileSync` from a module the test loads.
