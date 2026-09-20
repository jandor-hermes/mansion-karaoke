# Auto-KJ — singer rotation plan (2026-09-20)

## Product goal

Keep the party fun by scheduling **singer turns**, not merely sorting songs.
People should get regular turns, first-time singers should join quickly, and
one person should not sing consecutive songs while anybody else is waiting.
The existing ▲/▼ controls remain the human KJ override.

## Behavior contract

Auto-KJ maintains these invariants for automatically placed songs:

1. **No back-to-back singer:** after Jordan sings, Auto-KJ will choose another
   waiting singer before Jordan again whenever another singer has a song queued.
2. **One turn per rotation:** a singer's second pending song cannot play before
   every other currently represented singer has had their first pending turn;
   the same applies to third turns, fourth turns, and so on.
3. **Newcomer bump:** somebody with no completed turn enters the current
   rotation ahead of repeat turns. They do not jump ahead of another newcomer
   who was already waiting.
4. **Recency breaks ties:** among singers at the same rotation depth, the singer
   who has gone longest since their last completed turn goes first. Never-sang
   singers count as least recently served; their original arrival order breaks
   ties.
5. **Singer song order is FIFO:** Auto-KJ never changes the order in which one
   singer submitted their own songs.
6. **Existing manual ordering wins:** moving an item with ▲/▼ marks that item as
   manually placed. Auto-KJ does not move it later. Play next and Play now are
   also explicit manual overrides.

### Direct answer on consecutive songs

**Yes, by default Auto-KJ prevents back-to-back songs by the same singer.**
There are only two intentional exceptions:

- that singer is the only person with anything queued; or
- somebody explicitly uses ▲/▼, Play next, or Play now to override the rotation.

If three Jordan songs are waiting and Athena adds one, Athena is inserted in a
position that breaks the Jordan run. At playback advancement, a final guard
also selects the earliest eligible different singer if an automatically placed
same-singer item somehow reaches the front.

## Identity

For version one, a singer is the normalized `requestedBy` value:

```text
trim -> collapse internal whitespace -> lowercase
```

Display keeps the submitted spelling. Two phones using the same normalized
name are one singer; changing names creates a new singer. This limitation is
shown in setup/help copy rather than hidden. Stable guest IDs can replace name
identity later without changing the scheduler.

## Scheduler model

The queue remains a linear list for display and playback, but placement is
calculated from **per-singer turns**.

For each queued item, calculate its `turnDepth`: its 1-based position among
that singer's pending songs. A singer's first pending song is depth 1, their
second is depth 2, etc.

The automatic ordering key is:

```text
(turnDepth, hasEverSung, lastTurnSequence, firstArrivalSequence)
```

Ascending order means:

- all depth-1 songs precede depth-2 songs;
- never-sang singers precede repeat singers at the same depth;
- least recently served repeat singer precedes a more recently served singer;
- stable arrival order resolves remaining ties.

A no-adjacency pass then chooses the earliest legal slot that does not put the
same singer on either side. If no legal slot exists, placement falls back to
the fair-key position rather than rejecting the enqueue.

### Placement without surprising reshuffles

Adding a song does **not** re-sort the existing queue. The server evaluates all
possible insertion gaps for the new item, rejects same-singer adjacency gaps
when alternatives exist, and chooses the gap closest to the ideal singer-turn
ordering. Existing items retain their relative order.

That preserves a stable phone display while giving every new song a good
default position.

### Playback safety guard

Insertion alone cannot repair every historical state — for example, three
songs added while Jordan was the only singer produce `Jordan, Jordan, Jordan`.
When Athena joins, one insertion can break only one adjacency.

Therefore queue advancement performs a final guard:

1. Look at the singer who just finished or was skipped.
2. If the next item has the same singer and a different **automatic** singer is
   waiting later, promote the earliest fair different-singer item to play next.
3. Do not jump over a manually placed next item; that is the human override.
4. If no other singer is waiting, play the same singer again normally.

This guard is what makes the no-back-to-back promise hold over sequences, not
just for one insertion.

## State

Add controller-owned, in-memory scheduling metadata:

- `singerKey` — normalized requester identity;
- `arrivalSequence` — stable enqueue tie-breaker;
- `placement: 'auto' | 'manual'`;
- `lastTurnSequenceBySinger` — incremented when a singer's song begins (not
  when it ends, so the currently singing person is immediately most recent).

The public queue item can expose `placement` for diagnostics, but does not need
to expose the internal singer key or recency map.

Controller restart already resets the ephemeral queue, so scheduler state may
reset with it. No misleading partial reconstruction from history is needed.

## Endpoint behavior

- `POST /queue`: use Auto-KJ and return `{ item, position, placement: 'auto' }`.
- `POST /queue/next`: explicit override; insert at front and mark manual.
- `POST /queue/play`: explicit override; unchanged.
- `POST /queue/move`: move to requested position and mark the moved item
  manual. A future optional "Return to rotation" action can clear this.
- Normal ended/skip advancement: apply the playback safety guard before
  issuing the next play command.

Auto-KJ is enabled by default. `KARAOKE_AUTO_KJ=off` sets the startup default
to plain append and is logged once at startup without affecting other queue
controls.

## Host setting and runtime toggle

Offer **“Automatically rotate singers”** as a host-level toggle in Controls.
Guests cannot change it.

- Default: on, unless `KARAOKE_AUTO_KJ=off` sets the startup default off.
- Off: ordinary Add appends to the end of the queue. ▲/▼, Play next, and Play
  now retain their existing behavior.
- On: future ordinary additions use Auto-KJ placement.
- Changing the setting affects **future additions only**. It never reshuffles
  the visible queue or changes the next song already waiting.
- Persist the host's runtime choice across controller restarts. Once the host
  changes it, that persisted choice wins over the environment startup default.
- Show the current mode beside the queue explanation so placement behavior is
  not mysterious.

## Guest UI

- Queue note while enabled: **“Auto-KJ gives everyone a turn. Use ▲▼ to change
  the order.”** While disabled: **“Auto-KJ is off. New songs are added to the
  end.”**
- Add toast: **“Added — currently #N in queue.”** Use the server's returned
  position; do not estimate it in the browser.
- If a manual move creates a same-singer repeat, allow it and show lightweight
  feedback: **“Order changed manually.”** No confirmation dialog.
- Do not label people with fairness scores or "priority" — the mechanism should
  feel welcoming, not competitive.

## Implementation slices

### 1. Pure scheduler

Create `apps/control-plane/src/auto-kj.ts` with small pure functions:

- `normalizeSinger(requestedBy)`
- `chooseInsertionIndex(newItem, queue, singerState)`
- `chooseNextIndex(queue, previousSinger, singerState)`

The scheduler receives state explicitly and has no clock dependency.

### 2. Control-plane integration

Wire scheduling into enqueue and advancement in `src/index.ts`. Track arrival
and turn sequences, add the environment kill switch, and return the selected
position from enqueue.

### 3. Manual override semantics

Mark move/next/play actions manual and confirm the playback guard never jumps
over a manually selected next song. Removal does not cause a full re-sort.

### 4. Guest UI

Add the queue explanation and position-aware toast in `guest-ui.ts`. Keep ▲/▼
behavior and touch target sizes unchanged.

## Verification

Unit cases:

- A adds three songs, then B adds one: B enters before A's next repeat.
- A/B/C each add one: stable arrival order when nobody has sung.
- A sings, then A and B enqueue: B precedes A by recency.
- A/B are waiting, newcomer C joins: C enters before repeat turns but does not
  leapfrog an earlier never-sang singer.
- Same singer under spelling/case/whitespace variations normalizes together.
- Only one singer queued: consecutive songs remain legal and enqueue succeeds.
- Manual move creates A/A: order is preserved.
- Play next and Play now remain exact overrides.

Sequence simulations (the important gate):

- Mixed arrivals across at least six singers and several rotations.
- Assert no automatic A/A playback while another automatic singer waits.
- Assert nobody receives turn N+1 while another represented singer still waits
  for turn N, excluding manual overrides.
- Assert newcomers receive a turn within the current rotation, after earlier
  newcomers.
- Assert per-singer song FIFO is never violated.
- Assert existing queue-item relative order never changes on enqueue.
- Assert every enqueue and advancement terminates for adversarial single-singer
  and heavily manual queues.

Integration tests cover enqueue response positions, manual move protection,
skip/ended advancement, kill-switch behavior, and the complete multi-singer
play sequence. Then run a manual party simulation with named singers and make
sure the visible order matches the server's issued play commands.

## Non-goals

- No song-duration balancing or singer performance limits.
- No permanent profiles or anti-name-change enforcement in version one.
- No continuous background re-sort of the visible queue.
- No attempt to override explicit human KJ decisions.
