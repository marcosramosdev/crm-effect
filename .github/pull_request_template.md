<!--
Keep this short and specific. The commit message is where the "why"
lives; this is where the reviewer gets the "what" and "how to try it".
-->

## Summary

<!-- One or two sentences. What does this PR do? -->

## What changed

<!-- Bullet list of the actual changes. Link file paths when useful. -->

## Test plan

<!--
How did you verify this works? How should the reviewer verify it?
Tick the boxes as you go.
-->

- [ ] `bun run --filter @z7/crm typecheck` clean.
- [ ] `bun run --filter @z7/crm lint` — no new errors beyond the pre-existing backlog.
- [ ] `bun run --filter @z7/crm build` succeeds.
- [ ] Feature / fix manually exercised in the browser (or the reason it can't be).

## Related

<!-- Link the issue this closes, or "Part of #N" for multi-PR work. -->

<!-- New deps: please justify briefly in the commit message or PR body. -->
