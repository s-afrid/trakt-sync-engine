# Project Instructions & Permissions for Trakt Sync Engine

## Autonomous Execution & Permissions
- Full authorization is granted to the AI assistant to read, write, modify, and delete files within this workspace.
- The assistant is authorized to execute development terminal commands (e.g., package installation, build, lint, dev server, git operations, file manipulations) directly without seeking manual confirmation for routine actions.
- Proactively perform required code changes and tests to fulfill user tasks efficiently.
- Don't run the server
- Don't run typecheck

## Core Function Specification & Verification Contract
The primary purpose and behavior of this application must strictly adhere to the following 4-pillar contract:
1. **15-Minute Cycle**: The background sync daemon checks Trakt activity on a recurring 15-minute schedule.
2. **Quiet Sleep (Smart Diffing)**: If no new movies or anime episodes were watched on Trakt since the last cycle, it remains completely quiet, consumes 0% active CPU, and never opens browser windows.
3. **Automated Anime Sync (Trakt ➔ MyAnimeList)**: Whenever an anime episode or series is watched on Trakt, the engine automatically updates the watched episode count and marks the series status as 'completed' on MyAnimeList (with smart finale and out-of-order watch detection).
4. **Automated Movie Sync (Trakt ➔ Letterboxd)**: Whenever a movie is watched/scrobbled on Trakt, the engine automatically generates the verified CSV (merging real-time history scrobbles with TMDB/IMDb IDs) and auto-imports/confirms it into Letterboxd via Playwright session persistence without manual interaction.

