# Party friction implementation — checkpoint (2026-09-20) — COMPLETE

All DO items from PARTY-FRICTION-PLAN.md implemented on `main` (pushed, 1b69e75).

## Landed
- Item 1 (d876d25): `/search` appends ` karaoke` server-side when the trimmed query lacks the substring (case-insensitive); `/suggest` untouched. 4 new tests.
- Items 2+4+5 (b4a10d5): preview anchor (`youtu.be/<id>`, target=_blank rel=noopener) in song action sheet incl. queue-card route; result titles wrap, status line "N results — ordered by YouTube relevance"; search-header spinner + grayed quick-adds while in flight; recents-on-focus suggestions + "Suggestions" label. 33 guest-ui tests.
- Test-harness type fix (`error: null as string | null`, was pre-existing tsc error).

## Verification (parent, integration checkout)
- `apps/control-plane`: `bun run test` 82/82; `bunx tsc --noEmit` clean; root `bun run typecheck` clean.
- Source greps confirm all new signatures present in served guest UI source.

## Cleanup
- Worktrees party-friction-{guestui,search} removed; branches deleted (local+remote; remote never had them).

## Not done (per plan)
- Item 3 (fade-out & skip): phase 2, needs `POST /control/fade` + extension volume ramp + guest-UI action.
- Item 6 (fullscreen dropout): monitor only — log `content load resolved` mode on recurrence.

Manual gate still pending: user should reload the temporary add-on / restart the dev controller and sanity-check the phone UI (spinner, preview link, wrapping).
