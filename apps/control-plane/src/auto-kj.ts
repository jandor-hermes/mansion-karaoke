/**
 * Auto-KJ — singer-turn scheduler (pure functions, no clock dependency).
 *
 * The queue stays a linear list for display and playback; placement is
 * calculated from per-singer turns. See AUTO-KJ-PLAN.md for the behavior
 * contract and the verification cases mirrored in tests/auto-kj.test.ts.
 */

export type Placement = 'auto' | 'manual' | 'off';

/** A queue item plus the controller-owned scheduling metadata. */
export type SchedulingItem = {
    itemId: string;
    singerKey: string;
    arrivalSequence: number;
    placement: Placement;
};

/** lastTurnSequenceBySinger: singerKey -> turn sequence when their song last BEGAN. */
export type LastTurnBySinger = Map<string, number>;

export type SchedulerState = {
    lastTurnBySinger: LastTurnBySinger;
};

const NEVER_SUNG = -1;

/** Singer identity v1: normalized `requestedBy` (trim -> collapse whitespace -> lowercase). */
export function normalizeSinger(requestedBy: string | undefined | null): string {
    return String(requestedBy ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 1-based turn depth among a singer's pending songs in `queue`. */
function turnDepth(item: SchedulingItem, queue: readonly SchedulingItem[], queueIndex: number): number {
    let depth = 1;
    for (let i = 0; i < queueIndex; i++) if (queue[i].singerKey === item.singerKey) depth++;
    return depth;
}

/** Recency of a singer's last completed-slot turn; never-sung sorts as least recent. */
function lastTurn(singerKey: string, state: SchedulerState): number {
    return state.lastTurnBySinger.get(singerKey) ?? NEVER_SUNG;
}

/** Automatic ordering key (ascending): (turnDepth, lastTurnSequence, firstArrivalSequence). */
function orderKey(item: SchedulingItem, queue: readonly SchedulingItem[], queueIndex: number, state: SchedulerState): [number, number, number] {
    return [turnDepth(item, queue, queueIndex), lastTurn(item.singerKey, state), item.arrivalSequence];
}

function keyCompare(a: [number, number, number], b: [number, number, number]): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] - b[2];
}

/** Fair index for `newSinger`'s next song, computed as a stable insertion into `queue`. */
function fairIndex(newSingerKey: string, newDepth: number, newArrival: number, newLastTurn: number, queue: readonly SchedulingItem[], state: SchedulerState): number {
    const newKey: [number, number, number] = [newDepth, newLastTurn, newArrival];
    for (let i = 0; i < queue.length; i++) {
        if (keyCompare(newKey, orderKey(queue[i], queue, i, state)) < 0) return i;
    }
    return queue.length;
}

/**
 * Choose the insertion index for a new item with the given singer key.
 *
 * Adding never re-sorts the existing queue: every candidate gap keeps existing
 * items in their relative order. Candidate gaps are scored by (1) how many
 * existing items with a smaller fair-key the insertion would jump over, (2)
 * same-singer adjacency (avoided when an equally clean gap exists), (3) the
 * distance to the ideal fair-key position, then the earliest gap. This keeps
 * stable phone display while giving every new song a good default position;
 * a singer-heavy queue may only have adjacency-clean slots far from the ideal
 * position, in which case order preservation wins over the adjacency rule.
 */
export function chooseInsertionIndex(
    newItem: { singerKey: string; arrivalSequence: number },
    queue: readonly SchedulingItem[],
    state: SchedulerState,
): number {
    const pendingSameSinger = queue.filter((item) => item.singerKey === newItem.singerKey).length;
    const newLastTurn = lastTurn(newItem.singerKey, state);
    const newKey: [number, number, number] = [pendingSameSinger + 1, newLastTurn, newItem.arrivalSequence];
    const ideal = fairIndex(newItem.singerKey, pendingSameSinger + 1, newItem.arrivalSequence, newLastTurn, queue, state);
    const keys = queue.map((item, index) => orderKey(item, queue, index, state));
    let best = 0;
    let bestScore: [number, number, number, number] | null = null;
    const scoreLess = (a: [number, number, number, number], b: [number, number, number, number]) => {
        for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
        return false;
    };
    for (let gap = 0; gap <= queue.length; gap++) {
        let inversions = 0;
        for (let i = gap; i < queue.length; i++) if (keyCompare(keys[i], newKey) < 0) inversions++;
        const adjacency = (queue[gap - 1]?.singerKey === newItem.singerKey || queue[gap]?.singerKey === newItem.singerKey) ? 1 : 0;
        const score: [number, number, number, number] = [inversions, adjacency, Math.abs(gap - ideal), gap];
        if (bestScore === null || scoreLess(score, bestScore)) {
            bestScore = score;
            best = gap;
        }
    }
    return best;
}

/**
 * Playback-safety guard: index in `queue` of the item that should play next.
 *
 * Returns 0 unless a same-singer automatic repeat reached the front while a
 * different singer waits. Manual overrides are never jumped over: a manually
 * placed front item plays as-is, and a manual item between the front and a
 * promotable candidate (or a manual candidate itself) blocks the promotion.
 */
export function chooseNextIndex(
    queue: readonly SchedulingItem[],
    previousSingerKey: string | null,
    _state: SchedulerState,
): number {
    if (!previousSingerKey || queue.length === 0) return 0;
    if (queue[0].singerKey !== previousSingerKey) return 0;
    if (queue[0].placement === 'manual') return 0;
    for (let i = 1; i < queue.length; i++) {
        const item = queue[i];
        if (item.singerKey !== previousSingerKey) {
            if (item.placement === 'manual') return 0;
            return i;
        }
        if (item.placement === 'manual') return 0;
    }
    return 0;
}
