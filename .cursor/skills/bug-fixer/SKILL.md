---
name: bug-fixer
description: Diagnoses and fixes software bugs with strict scope control. Use when the user asks to debug, fix failing behavior, resolve errors, or identify root cause and apply a minimal targeted patch.
---

# Bug Fixer

## Goal

Fix the bug with the smallest safe change set.

## Operating Rules

1. Identify the root cause before editing.
2. Explain why the bug occurs (failing assumption, edge case, state, data shape, timing, API contract, etc.).
3. Apply the minimal fix needed to resolve the bug.
4. Do not modify unrelated files, symbols, formatting, or refactor adjacent code unless required for the fix.
5. Preserve existing behavior outside the bug scope.

## Workflow

1. Reproduce or isolate the failure.
2. Trace execution to the first incorrect state/value.
3. Confirm root cause with evidence from code/runtime output.
4. Implement a narrow patch at the fault location.
5. Run targeted verification for the bug path.
6. Report exactly what changed and why.

## Scope Guardrails

- Touch only files directly involved in the bug.
- Avoid opportunistic cleanup, renames, style-only edits, and broad refactors.
- If a broader change seems necessary, stop and ask for approval before expanding scope.

## Response Format

Use this structure when reporting results:

```markdown
Root cause:
- <single precise cause>

Why it broke:
- <short mechanism explaining failure>

Fix applied:
- <minimal code change>
- Files changed: <list>

Verification:
- <targeted test/command/result>

Scope check:
- Confirmed no unrelated files were changed.
```

## When Not to Proceed

If the issue cannot be fixed minimally without architecture-level changes, state the blocker and propose the smallest viable next step.
