import { describe, expect, it } from 'vitest';

import { enrichContentEvent, mapDomEvent } from '../src/events';

const active = { commandId: 'generation-1', roomId: 'room-1', itemId: 'item-1', videoId: 'dQw4w9WgXcQ' };

describe('content event routing', () => {
    it('maps DOM playback names to protocol event names', () => {
        expect(mapDomEvent({ type: 'loadedmetadata', position: 2 })).toEqual({ type: 'ready', position: 2 });
        expect(mapDomEvent({ type: 'playing', position: 3 })).toEqual({ type: 'playing', position: 3 });
        expect(mapDomEvent({ type: 'pause', position: 4 })).toEqual({ type: 'paused', position: 4 });
        expect(mapDomEvent({ type: 'ended', position: 5 })).toEqual({ type: 'ended', position: 5 });
        expect(mapDomEvent({ type: 'error', position: 6, code: 'MEDIA_ERR', message: 'failed' })).toEqual({ type: 'error', position: 6, code: 'MEDIA_ERR', message: 'failed' });
    });

    it('drops DOM events that do not map to the playback protocol', () => {
        expect(mapDomEvent({ type: 'unknown', position: 1 })).toBeNull();
    });

    it('enriches a mapped event with active playback identity and monotonic metadata', () => {
        expect(enrichContentEvent({ type: 'playing', ...active, position: 12 }, active, 7, 1700000000000)).toEqual({
            type: 'playing', ...active, position: 12, sequence: 8, timestamp: 1700000000000,
        });
    });

    it('does not enrich an event without an active command, room, and item', () => {
        expect(enrichContentEvent({ type: 'playing', position: 1 }, { roomId: 'room-1', commandId: 'generation-1' }, 0, 1)).toBeNull();
    });

    it('drops an event from a different playback generation', () => {
        expect(enrichContentEvent({ type: 'ended', ...active, commandId: 'generation-0' }, active, 0, 1)).toBeNull();
    });
});
