# ZCode Preservation Matrix — Web Adaptation

The original handoff required building PlayLiquid on a fork of the complete
ZCode desktop application. **This repository is the Next.js web adaptation**;
there is no ZCode desktop fork in this environment. This matrix maps, honestly,
what was preserved in spirit, what was re-homed, and what is out of scope.

| ZCode capability (handoff) | Status in this adaptation | Where |
| --- | --- | --- |
| Task creation & lifecycle | Adapted | `views/new-task.tsx` → `POST /api/tasks` → agent-generated game records |
| Agent selection & orchestration | Adapted | Agent roster (Game Architect / World Builder / Avatar Smith) in New Task; Build Agent in the builder |
| Model selection | Adapted | Model picker (GLM-4.6 default) in New Task; model recorded on each Task row |
| Model/provider settings page | **Out of scope here** | No provider registry exists in this web app; belongs to the desktop-fork track |
| Workspace/project selection | Adapted | Workspace picker in New Task (PlayLiquid Labs · Main) |
| Terminal / browser tools | Out of scope (web adaptation) | — |
| Settings page preservation | **Not applicable** | Nothing was removed — this app never had a ZCode settings page to preserve |
| Task history & recovery | Adapted | "Recent tasks" in New Task; Task rows persist in SQLite |
| Execution (game generation) | Adapted | `POST /api/agent` applies real theme patches; task prompts produce real, playable games |

## What "preservation" means here

Nothing in this adaptation **replaced** a ZCode feature with a fake: the
task→agent→builder→publish pipeline performs real writes (Game rows, theme
JSON, status/version transitions) and is browser-verified end-to-end.
See `docs/verification/ACCEPTANCE-REPORT.md`.

Upstream ZCode (zai-org/ZCode) licensing/attribution obligations apply only to
the desktop-fork track and are not triggered by this codebase.
