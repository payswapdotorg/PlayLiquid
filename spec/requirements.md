# PlayLiquid GameOS Requirements

## Product

R1. Games are Git repositories with branch/commit/PR/release lifecycle.
R2. Public/private and open/closed-source modes are supported.
R3. Forks preserve lineage and can retain/replace world/assets/avatars independently.
R4. Everything reusable is packageable and independently versioned.
R5. Avatars are portable and host games can restrict their capabilities.
R6. Spark is a 9:16 mobile-first fast-start target.
R7. Leaderboards, multiplayer, replay, rewards, social, achievements, analytics, moderation and integrity are platform services.
R8. Replay is reusable by players, QA, integrity, simulation and Lab.
R9. Multiplayer outcomes are authoritative server/runtime state.
R10. Play-to-earn/rewards use platform entitlement/economy infrastructure.
R11. GameOS exposes probabilistic competitive-integrity evidence.
R12. Builds support web, desktop, mobile, XR, dedicated server and console workflows where toolchains permit.
R13. Unreal, Unity, Godot, PlayCanvas and Blender integrate through Tool Fabric.
R14. GameIR remains engine-independent.
R15. Worlds support spatial partitioning and streaming.
R16. Lab searches and learns organizations, tools and capability allocation.
R17. Lab learns from real project evidence over time.
R18. Capability gaps can trigger user/community contribution or Arena escalation.
R19. Provenance/licensing is a release/build gate.
R20. Least-privilege capability enforcement and tenant isolation are mandatory.

## Engineering

E1. One owner per mutable state.
E2. One canonical command/event path per behavior.
E3. Provider SDKs do not leak into domain contracts.
E4. Engine-specific implementation stays behind adapters.
E5. UI consumes authoritative contracts/read models.
E6. Long-running work is durable/queued/resumable.
E7. Large binaries do not live wholesale in ordinary Git history.
E8. Negative security/concurrency/anti-gaming tests are mandatory.
E9. Reproducible seeds/locks are used where feasible.
E10. Historical evidence is immutable.
E11. External platform limitations are represented truthfully.
