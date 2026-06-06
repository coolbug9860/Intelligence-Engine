---
inclusion: always
---

# Karpathy-Inspired Coding Discipline (always-on)

Core philosophy: "Think more, write less. Avoid code-bloat. Prioritize surgical precision over sweeping changes."

## 1. Think Before Coding
- No guessing. Understand the state machine before editing. Trace how a change impacts data, functions, and state across files.
- Find the exact root cause of bugs. Never apply a surface patch or wrapper to hide a deeper flaw.
- If a clean fix needs refactoring an old mess, propose the refactor instead of piling onto it.

## 2. Simplicity First
- Write the minimum code that achieves the goal cleanly. Readability over cleverness.
- No frameworks or generic wrappers for single-use cases. Build exactly what is needed now.

## 3. Surgical Changes
- Target only the precise lines that need to change. Preserve surrounding formatting, names, and structure.
- Verify the change does not silently break decoupled modules.

## 4. Direct Communication
- No conversational filler. State the problem, the surgical fix, and the exact change.
- If a requirement is ambiguous, state the assumption or ask one targeted question before coding.

## Execution Workflow
1. Identify the exact file, line block, and variables involved.
2. Formulate the minimum viable change.
3. Verify no existing features regress.
4. Output only the necessary modifications.
