/**
 * qa/browser module manifest (PL-043 delivery; promotion into
 * architecture-policy.yaml is a TL merge-time action, per the PL-010
 * governance format).
 *
 * requires mirrors every workspace module whose public source this
 * browser-journey suite imports (the PL-033 packages/web/gameos mount
 * precedent: qa/ is not a pnpm workspace root, so sibling packages are
 * imported by relative path, and no package.json/workspace importer
 * exists here — the TL owns that surface). The journeys walk the REAL
 * public surfaces of:
 *
 * - game-ui: the Game Studio store, ports, doubles and pure view models
 *   (PL-033) — reached through src/studio-ui.ts;
 * - gameos-lab: the Lab workbench store, ports and view-model snapshot
 *   types (PL-034) — reached through src/lab-ui.ts;
 * - gameos-community: the Community workbench store, ports and view-model
 *   snapshot types (PL-034) — reached through src/community-ui.ts;
 * - lab-contracts + lab-simulation + lab-organization + lab-learning +
 *   arena-integration + arena-integration-runtime: the REAL Lab loop
 *   engines and the Arena escalation runtime the lab journey drives;
 * - community + platform-contracts: the REAL contribution service and the
 *   tenancy vocabulary the community journey drives;
 * - package-system + runtime-core + runtime-contracts +
 *   capability-broker + avatar-runtime + game-contracts +
 *   tool-fabric-runtime: the real sibling read models the studio journey
 *   composes (PL-033's five surfaces);
 * - native-game: the LUMEN RUN canonical playthrough (PL-037) the native
 *   journey runs.
 *
 * THE THREE ui ADAPTERS (studio-ui.ts / lab-ui.ts / community-ui.ts) are
 * deliberate and documented in place: the three web packages' index.ts
 * entrypoints re-export their presentational .tsx component sets, which
 * plain `node --test` (this suite's E11-honest runner: no browser, no
 * bundler) refuses to load outright — Node type-stripping does not
 * transform JSX. The adapters reach ONLY the Node-loadable public surface
 * (stores, ports, pure view models — every symbol the entrypoints also
 * export), so redirecting them to the entrypoints is a one-file change
 * the moment a Node-loadable entry exists. The promotion-time decision
 * (entrypoint restructure vs a recorded exception) is the TL's.
 */
export const qaBrowserModule = {
  id: "qa-browser",
  requires: [
    "arena-integration",
    "arena-integration-runtime",
    "avatar-runtime",
    "capability-broker",
    "community",
    "game-contracts",
    "game-ui",
    "gameos-community",
    "gameos-lab",
    "lab-contracts",
    "lab-learning",
    "lab-organization",
    "lab-simulation",
    "native-game",
    "package-system",
    "platform-contracts",
    "runtime-contracts",
    "runtime-core",
    "tool-fabric-runtime",
  ],
  provides: ["qa-browser"],
  publicEntrypoints: ["src/index.ts"],
} as const;
