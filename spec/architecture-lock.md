# PlayLiquid GameOS Architecture Lock

Version: 1.0
Status: FROZEN

1. GameIR is the semantic kernel.
2. Package Graph is the composition/dependency authority.
3. Git is the project lifecycle authority.
4. Capability Broker is the runtime authorization boundary.
5. ZCode remains the AI workspace/model/provider authority.
6. Arena is an external human-capability provider.
7. Everything reusable is a package.
8. Packages are immutable/versioned/addressable.
9. Large binary artifacts use content-addressed storage.
10. Game lockfiles pin exact package versions/digests.
11. Provenance and licensing are first-class.
12. Interactive and simulation runtimes share semantic contracts but are distinct execution paths.
13. AI emits typed intents; authoritative systems own state mutation.
14. Avatar intelligence never receives arbitrary engine authority.
15. Replay is a platform primitive.
16. Spark is a target profile, not a second game model.
17. Leaderboard, multiplayer, replay, rewards, achievements, social, analytics, moderation and integrity are platform capabilities.
18. Games declare semantic events and policies; they do not duplicate platform authorities.
19. Competitive outcomes are authoritative outside the untrusted client.
20. Engines and DCC tools are adapters/native bindings, not GameIR authorities.
21. Tool Fabric is provider-neutral.
22. MCP is integration transport only.
23. Mature tools are integrated before replacement.
24. Console capability is SDK/toolchain gated and must be proven.
25. Lab organization search is contextual and evidence-driven.
26. Generalist baseline is mandatory.
27. Historical observations are immutable.
28. Counterfactuals are explicitly labeled estimates.
29. Simulator output is not ground truth.
30. Capability gaps are explicit and auditable.
31. Human contribution is optional unless a task contract requires it.
32. Arena escalation is external.
33. Lab never publishes or directly mutates production state.
34. Forks preserve lineage.
35. Semantic PRs include package/world/avatar/policy/simulation evidence.
36. One Work Order = one branch = one PR = one frozen write surface.
37. Maximum 3 concurrent workers.
38. Workers do not merge.
39. TL owns shared/root/governance surfaces.
40. No second workflow, model-routing, package-registry or experiment authority.
41. No client-authoritative rewards.
42. No rights circumvention.
43. No fake engagement or anti-abuse evasion.
44. No hidden mocks presented as production.
45. No completion claim without evidence.
