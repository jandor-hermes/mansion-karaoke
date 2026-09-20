import { describe, expect, it } from 'vitest';
import { chooseInsertionIndex, chooseNextIndex, normalizeSinger, type SchedulerState, type SchedulingItem } from '../src/auto-kj.js';

let arrival = 0;
const freshState = (): SchedulerState => ({ lastTurnBySinger: new Map() });
const item = (singer: string, placement: SchedulingItem['placement'] = 'auto'): SchedulingItem => ({
    itemId: `item-${singer}-${++arrival}`,
    singerKey: normalizeSinger(singer),
    arrivalSequence: arrival,
    placement,
});
const singers = (queue: readonly SchedulingItem[]) => queue.map((entry) => entry.singerKey);

/** Drives the scheduler the way the control plane does: enqueue inserts, advancement promotes then shifts. */
function playSequence(queue: SchedulingItem[], state: SchedulerState): string[] {
    const played: string[] = [];
    let previous: string | null = null;
    while (queue.length) {
        const index = chooseNextIndex(queue, previous, state);
        if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
        const next = queue.shift()!;
        state.lastTurnBySinger.set(next.singerKey, played.length + 1);
        played.push(next.singerKey);
        previous = next.singerKey;
    }
    return played;
}

/** Auto-KJ enqueue only; manual requests jump to the front like Play next. */
function enqueueSequence(requests: Array<{ singer: string; manual?: boolean }>): string[] {
    const state = freshState();
    const queue: SchedulingItem[] = [];
    for (const request of requests) {
        const newItem = item(request.singer, request.manual ? 'manual' : 'auto');
        const index = request.manual ? 0 : chooseInsertionIndex({ singerKey: newItem.singerKey, arrivalSequence: newItem.arrivalSequence }, queue, state);
        queue.splice(index, 0, newItem);
    }
    return playSequence(queue, state);
}

describe('normalizeSinger', () => {
    it('normalizes case, surrounding and internal whitespace together', () => {
        expect(normalizeSinger('  Jordan   Schulz ')).toBe('jordan schulz');
        expect(normalizeSinger('JORDAN SCHULZ')).toBe(normalizeSinger('jordan schulz'));
        expect(normalizeSinger(undefined)).toBe('');
    });
});

describe('insertion', () => {
    it('places a newcomer before an established singer\'s repeat turn', () => {
        const queue = [item('a'), item('a'), item('a')];
        const b = item('b');
        const index = chooseInsertionIndex({ singerKey: b.singerKey, arrivalSequence: b.arrivalSequence }, queue, freshState());
        expect(singers([...queue.slice(0, index), b, ...queue.slice(index)])).toEqual(['a', 'b', 'a', 'a']);
    });

    it('keeps stable arrival order when nobody has sung', () => {
        const queue = [item('a'), item('b'), item('c')];
        const d = item('d');
        expect(chooseInsertionIndex({ singerKey: d.singerKey, arrivalSequence: d.arrivalSequence }, queue, freshState())).toBe(3);
    });

    it('never-sang singer precedes a repeat singer at the same depth', () => {
        // a has sung (turn 1) and re-adds a song; b is a never-sang newcomer.
        const state = freshState();
        state.lastTurnBySinger.set('a', 1);
        const a = item('a');
        const queue: SchedulingItem[] = [];
        const aIndex = chooseInsertionIndex({ singerKey: a.singerKey, arrivalSequence: a.arrivalSequence }, queue, state);
        queue.splice(aIndex, 0, a);
        const b = item('b');
        const bIndex = chooseInsertionIndex({ singerKey: b.singerKey, arrivalSequence: b.arrivalSequence }, queue, state);
        queue.splice(bIndex, 0, b);
        expect(singers(queue)).toEqual(['b', 'a']);
    });

    it('keeps a single-singer queue consecutive and enqueue succeeds', () => {
        const queue = [item('solo')];
        const second = item('solo');
        expect(chooseInsertionIndex({ singerKey: second.singerKey, arrivalSequence: second.arrivalSequence }, queue, freshState())).toBe(1);
    });

    it('does not re-sort existing items: only inserts', () => {
        const queue = [item('a'), item('b'), item('a')];
        const before = singers(queue);
        const c = item('c');
        const index = chooseInsertionIndex({ singerKey: c.singerKey, arrivalSequence: c.arrivalSequence }, queue, freshState());
        expect(singers(queue)).toEqual(before);
        expect(singers([...queue.slice(0, index), c, ...queue.slice(index)])).toEqual(['a', 'b', 'c', 'a']);
    });
});

describe('playback guard (chooseNextIndex)', () => {
    it('promotes the earliest different-singer item past an automatic same-singer repeat', () => {
        const queue = [item('a'), item('a'), item('b'), item('c')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(2);
    });

    it('never jumps a manually placed front item', () => {
        const queue = [item('a', 'manual'), item('b')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });

    it('never jumps over a manual item between the front and the candidate', () => {
        const queue = [item('a'), item('b', 'manual'), item('c')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });

    it('does not promote a manual candidate', () => {
        const queue = [item('a'), item('a'), item('b', 'manual')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });

    it('allows same-singer playback when no other singer waits', () => {
        const queue = [item('a'), item('a')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });

    it('returns 0 when the front singer differs from the previous singer', () => {
        const queue = [item('b'), item('a')];
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });
});

describe('plan unit cases as full sequences', () => {
    it('A adds three songs, then B adds one: B plays before A\'s next repeat', () => {
        const played = enqueueSequence([{ singer: 'a' }, { singer: 'a' }, { singer: 'a' }, { singer: 'b' }]);
        expect(played.slice(0, 2)).toEqual(['a', 'b']);
        expect(played.lastIndexOf('a')).toBeGreaterThan(played.indexOf('b'));
    });

    it('A/B/C each add one: stable arrival order when nobody has sung', () => {
        expect(enqueueSequence([{ singer: 'a' }, { singer: 'b' }, { singer: 'c' }])).toEqual(['a', 'b', 'c']);
    });

    it('A sings, then A and B enqueue: B precedes A by recency', () => {
        const state = freshState();
        state.lastTurnBySinger.set('a', 1);
        const queue: SchedulingItem[] = [];
        for (const singer of ['a', 'b']) {
            const newItem = item(singer);
            const index = chooseInsertionIndex({ singerKey: newItem.singerKey, arrivalSequence: newItem.arrivalSequence }, queue, state);
            queue.splice(index, 0, newItem);
        }
        expect(singers(queue)).toEqual(['b', 'a']);
    });

    it('newcomer C enters before repeat turns but not ahead of an earlier never-sang singer', () => {
        const state = freshState();
        state.lastTurnBySinger.set('a', 1);
        state.lastTurnBySinger.set('b', 2);
        // a re-adds a repeat song; newcomer c arrives after: c plays before a's repeat.
        const queue: SchedulingItem[] = [];
        const a = item('a');
        let index = chooseInsertionIndex({ singerKey: a.singerKey, arrivalSequence: a.arrivalSequence }, queue, state);
        queue.splice(index, 0, a);
        const c = item('c');
        index = chooseInsertionIndex({ singerKey: c.singerKey, arrivalSequence: c.arrivalSequence }, queue, state);
        queue.splice(index, 0, c);
        expect(singers(queue)).toEqual(['c', 'a']);
    });

    it('manual move creating A/A is preserved and never repaired automatically', () => {
        const queue = [item('b'), item('a')];
        const movedA = queue.splice(1, 1)[0];
        movedA.placement = 'manual';
        queue.unshift(movedA);
        expect(singers(queue)).toEqual(['a', 'b']);
        expect(chooseNextIndex(queue, 'a', freshState())).toBe(0);
    });

    it('Play next and Play now remain exact overrides', () => {
        const queue = [item('a', 'manual'), item('a'), item('b')];
        expect(chooseNextIndex(queue, 'b', freshState())).toBe(0);
    });
});

describe('sequence simulations', () => {
    it('mixed arrivals across six singers and several rotations hold every fairness invariant', () => {
        const names = ['a', 'b', 'c', 'd', 'e', 'f'];
        for (let trial = 0; trial < 40; trial++) {
            const state = freshState();
            const queue: SchedulingItem[] = [];
            let arrivalCounter = 0;
            const insert = (singer: string) => {
                const newItem: SchedulingItem = { itemId: `t${trial}-${singer}-${arrivalCounter}`, singerKey: singer, arrivalSequence: ++arrivalCounter, placement: 'auto' };
                const before = singers(queue);
                const index = chooseInsertionIndex(newItem, queue, state);
                queue.splice(index, 0, newItem);
                expect(singers(queue).filter((_, i) => i !== index), `trial ${trial} re-sort`).toEqual(before);
            };
            const played: string[] = [];
            const playedDepths: Array<{ singerKey: string; depth: number }> = [];
            let previous: string | null = null;
            const advance = () => {
                const index = chooseNextIndex(queue, previous, state);
                if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
                const item = queue[0];
                // No automatic back-to-back while another singer waits.
                if (item.singerKey === previous) {
                    const others = new Set(queue.map((entry) => entry.singerKey));
                    others.delete(item.singerKey);
                    expect(others.size, `trial ${trial} back-to-back at play ${played.length}`).toBe(0);
                }
                // No N+1 rotation turn while another represented singer still waits for
                // turn N: pending-depth turns (the scheduler's own ordering key), so a
                // singer's oldest pending song is rotation turn 1 even after many songs.
                const pendingDepth = 1 + queue.slice(0, queue.indexOf(item)).filter((entry) => entry.singerKey === item.singerKey).length;
                if (pendingDepth >= 2) {
                    const depthPlayed: Record<string, number> = {};
                    for (const entry of playedDepths) depthPlayed[entry.singerKey] = Math.max(depthPlayed[entry.singerKey] ?? 0, entry.depth);
                    const pendingBySinger: Record<string, number> = {};
                    for (const entry of queue) pendingBySinger[entry.singerKey] = (pendingBySinger[entry.singerKey] ?? 0) + 1;
                    for (const [singer, pending] of Object.entries(pendingBySinger)) {
                        if (singer === item.singerKey || pending === 0) continue;
                        expect(depthPlayed[singer] ?? 0, `trial ${trial}: ${item.singerKey} rotation turn ${pendingDepth} while ${singer} waits for rotation turn ${(depthPlayed[singer] ?? 0) + 1}`).toBeGreaterThanOrEqual(pendingDepth - 1);
                    }
                }
                queue.shift();
                state.lastTurnBySinger.set(item.singerKey, played.length + 1);
                played.push(item.singerKey);
                playedDepths.push({ singerKey: item.singerKey, depth: pendingDepth });
                previous = item.singerKey;
            };
            let seed = trial * 7919 + 13;
            const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
            let pendingAdds = 24;
            while (pendingAdds > 0 && played.length < 60) {
                if (queue.length < 2 || random() < 0.45) {
                    insert(names[Math.floor(random() * names.length)]);
                    pendingAdds--;
                } else if (queue.length > 0) advance();
            }
            while (queue.length > 0 && played.length < 80) advance();
            expect(pendingAdds, `trial ${trial} terminated`).toBe(0);
            expect(queue.length, `trial ${trial} drained`).toBe(0);
        }
    });

    it('terminates for adversarial single-singer and heavily manual queues', () => {
        expect(enqueueSequence([{ singer: 'solo' }, { singer: 'solo' }, { singer: 'solo' }])).toEqual(['solo', 'solo', 'solo']);
        expect(enqueueSequence([
            { singer: 'a', manual: true }, { singer: 'b', manual: true }, { singer: 'a' }, { singer: 'c', manual: true }, { singer: 'b' },
        ]).length).toBe(5);
    });
});
