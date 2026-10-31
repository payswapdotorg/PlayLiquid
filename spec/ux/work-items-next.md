# Next UX/Product Work Ledger — 2026-10-31

This ledger supersedes the old Game Studio-first UX contract for new work. Historical work remains intact. Canonical product authority: `PRODUCT-NORTH-STAR.md`; mission: `docs/handoff/FINAL-TL-HANDOFF-2026-10-31.md`.

Rules: max 3 concurrent workers; one WO = one worker = one branch = one PR = one frozen write surface; workers do not merge. TL owns root/shared composition, architecture lock/ACR, route registrations, manifests/lockfiles, release workflows and final integration. Base SHA is the branch's current parent/main SHA; TL must record exact current base before dispatch.

## PLX-UX-001 — ZCode-native New Task and navigation
Owner: Worker A. Dependencies: baseline audit; Figma correction.
Write surface: renderer New Task/shell/sidebar component trees and colocated tests only; exact paths frozen by TL after inspection. Do not edit root manifests, central composition root, ZCode model/provider internals or release workflow.
Requirements: New Task first-run; Select project dropdown above composer; attachment/access/model controls inherited; top-right Browser/Terminal toggles use existing ZCode panels; sidebar exposes Search, Automations, Plugin Marketplace, Groups/Projects/tasks, Home/Sparks/Subscriptions/Live & Replays/Your Channel/Liked/History and full Settings. Full ZCode model settings parity.
Proof: model/provider regression tests; project assignment; panel toggles; browser screenshots 1280x800, 390x844 and 480px min desktop; keyboard/accessibility.

## PLX-UX-002 — WebFlix-style player and discovery
Owner: Worker B. Dependencies: WebFlix license/source audit and approved Figma map.
Write surface: player/discovery UI component trees and tests only; no shared shell route registration, domain contracts or release workflow.
Requirements: Home landscape cards, poster-first hover previews, infinite scroll, Continue Watching/Playing, Spark shelf; long-form World play page; instant in-feed Sparks; World Details; channel/subscriptions/liked/history. Previews isolated/disposable and resource-limited.
Proof: real playable session path; hover preview launch/cancel; fallback poster; touch behavior; Sparks auto-enter without Play CTA or redirect; screenshots and tests.

## PLX-UX-003 — World Projects and social/live/replay
Owner: Worker C. Dependencies: World-kind ACR; existing Git/package/live/replay authorities audit.
Write surface: project workspace and social/live/replay UI module trees + colocated tests; no central route registration or shared contracts.
Requirements: world projects, tasks, package composition, semantic PR/review; Your Channel/Subscriptions/Live & Replays/Live Player/Start Live/Replay. Reuse existing live implementation if legally and technically ready; do not create duplicate broadcast stack.
Proof: real branch/PR lifecycle; live session/chat; durable replay record/index/play; semantic package diff; browser evidence.

## PLX-ARCH-001 — World kind/profile and Spark semantic reconciliation
Owner: TL (architecture owner). Dependencies: none.
Write surface: Architecture Change Request, architecture/requirements/graph/matrix/compatibility plan; no worker may change semantic kernel before approval.
Requirements: World kinds include Spark/game/experience/digital_twin/other; target profiles separate. Existing GameIR/Package Graph remain single authority. Reconcile old Spark-only-target lock.
Proof: accepted ACR; migration/compatibility tests; no duplicate World type.

## PLX-REL-001 — Cross-platform installable delivery
Owner: TL or dedicated release worker after disjoint ownership is set. Dependencies: inspect existing release workflow.
Write surface: release workflows, packaging config and release docs only; no UI or semantic contracts.
Requirements: every main merge has Linux .deb/AppImage and Windows .exe installer/portable ZIP preview artifacts from exact SHA; stable tags publish both OS families, checksums, provenance and notes. Packaged GUI smoke tests.
Proof: install/launch/upgrade/uninstall on actual OS runners; README direct links; checksum/source SHA verification.

## Dispatch sequence
1. TL performs baseline audit, Figma correction and file-level ownership mapping.
2. PLX-ARCH-001 begins immediately; other work that depends on World kind waits for ACR.
3. Dispatch PLX-UX-001/002/003 only when write surfaces are pairwise disjoint.
4. PLX-REL-001 can run in parallel only after workflow ownership is disjoint from root integration and existing release work.
5. TL merges only after source + tests + runtime + browser + packaged build evidence agree. Update this ledger with branch, PR, base/head/merge SHA, test results and evidence URLs.
