# Noticeboard — CLAUDE.md

## Session-Based Build
This project is built across 8 sessions. Each session has a fixed scope defined in
`.claude/plans/we-need-to-create-lucky-meerkat.md`.

## Starting a Session
1. Read `HANDOVER.md` if it exists — it tells you exactly where to continue
2. Read the plan file for this session's scope
3. Use TodoWrite to list this session's files before starting
4. Confirm with the user: "Starting Session N — [scope]. Continuing from: [last completed file]."

## During a Session
- Mark each file done in TodoWrite immediately after writing it
- After every 5 files created, note how many remain in the session scope
- If the conversation is growing very long (many files read back, long exchanges), wrap up early:
  write HANDOVER.md, tell the user to start a new session
- Never leave a file half-written — always finish the current file before stopping
- User feedback: apply it immediately, update the plan file, note the decision in HANDOVER.md

## Ending a Session
1. Finish the current file completely
2. Write HANDOVER.md using the template below
3. Tell the user: "Session N complete. Please start a new Claude Code session and say
   'continue noticeboard from handover'."

## HANDOVER.md Template

```
# Handover — Session N — YYYY-MM-DD

## Completed This Session
- path/to/file1.js
- path/to/file2.js

## Next Session (Session N+1) Scope
[Copy the scope description from the plan file]

## Design Decisions Made This Session
[Any deviations from or additions to the plan, with the reason]

## Known Issues / TODOs
[Anything incomplete, edge cases to revisit, warnings noticed]

## How to Resume
Start a new Claude Code session in the project directory and say:
"continue noticeboard from handover"
```

## No Duplication Rule
All shared server logic lives in `server/utils/`. Both frontend apps import from
`client/shared/`. Before writing any utility function, grep the codebase to confirm
it does not already exist somewhere.

## Key File Locations
- Plan: `.claude/plans/we-need-to-create-lucky-meerkat.md`
- Config service: `server/services/configService.js` — singleton, init() on startup
- Path helpers: `server/utils/pathHelpers.js` — use for ALL file paths, never hardcode
- Logger: `server/utils/logger.js` — always use this, never console.log in server code
- Shared constants: `client/shared/constants.js` — socket event names and API base
