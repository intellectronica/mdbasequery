## Git Workflow — CRITICAL, MANDATORY, NO EXCEPTIONS

> **THIS IS NOT OPTIONAL.** Every agent operating in this repository MUST follow this workflow after every change, no matter how small. There are ZERO exceptions to this rule. Skipping a commit is never acceptable. If you have made any change to any file, you MUST commit before moving on.

### Rules

1. **ALWAYS commit your changes immediately after completing a task or reaching any logical stopping point.** Do not defer. Do not batch. Do not skip.
2. **After every commit, immediately run `git pull --rebase` followed by `git push`.** The remote repository MUST be kept in sync with local at all times. This is not optional.
3. **ALWAYS commit (and pull-rebase-push) before ending your session.** The working directory MUST be clean and the remote MUST be up to date when you finish. Leaving uncommitted or unpushed changes is a failure state.
4. **Use clear, descriptive commit messages** that explain what was done and why.
5. **If in doubt, commit.** It is always better to have one commit too many than one too few.

### Required sequence after every change

```
git add <files>
git commit -m "<message>"
git pull --rebase
git push
```

### To be absolutely clear

- "I'll commit later" — **No. Commit now.**
- "It's just a small change" — **Commit it.**
- "I'm about to make another change" — **Commit the current one first.**
- "The user didn't ask me to commit" — **Irrelevant. Commit anyway.**
- "I committed but didn't push" — **That is not done. Pull-rebase and push immediately.**
