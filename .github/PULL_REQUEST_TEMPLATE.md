# PlayLiquid GameOS Work Order

## Work Order
- ID:
- Base SHA:
- Worker:

## Frozen surface
- Declared:
- Actual:

## Change
Describe the contract/behavior change.

## Evidence
- Tests:
- Architecture check:
- Runtime:
- Browser:
- Build/deployment:
- External limitations:

## State ownership
Name the single authoritative owner for every mutable state changed.

## Event order
For async/stateful changes, record admission → transition → event → persistence/replay semantics.

## Scope
Confirm no unrelated files or authorities were changed.

## Acceptance
Map each Work Order acceptance criterion to evidence.

## Prohibited drift check
- [ ] No second workflow/execution authority.
- [ ] No second model-routing authority.
- [ ] No engine-specific types in GameOS contracts.
- [ ] No hidden mock presented as production.
- [ ] No rights/provenance bypass.
- [ ] No client-authoritative competitive outcome.
