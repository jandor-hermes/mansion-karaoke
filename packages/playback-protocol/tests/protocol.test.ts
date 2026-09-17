import { describe, expect, it } from 'vitest';

import {
    playbackCommandSchema,
    playbackEventSchema,
    type PlaybackCommand,
    type PlaybackEvent,
} from '../src';

const videoId = 'dQw4w9WgXcQ';

describe('playback command protocol', () => {
    it('accepts a play command with its playback identity and timing', () => {
        const command: PlaybackCommand = {
            type: 'play',
            commandId: 'cmd-1',
            roomId: 'room-1',
            itemId: 'item-1',
            videoId,
            position: 12.5,
            issuedAt: 1710000000000,
        };

        expect(playbackCommandSchema.parse(command)).toEqual(command);
    });

    it('accepts control commands and rejects malformed command identity', () => {
        expect(playbackCommandSchema.safeParse({ type: 'pause', commandId: 'cmd-2', roomId: 'room-1', issuedAt: 1710000000000 }).success).toBe(true);
        expect(playbackCommandSchema.safeParse({ type: 'setVolume', commandId: 'cmd-3', roomId: 'room-1', volume: 0.75, issuedAt: 1710000000000 }).success).toBe(true);
        expect(playbackCommandSchema.safeParse({ type: 'skip', commandId: '', roomId: 'room-1', issuedAt: 1710000000000 }).success).toBe(false);
    });

    it('rejects invalid volume and negative position', () => {
        const base = { commandId: 'cmd-1', roomId: 'room-1', issuedAt: 1710000000000 };
        expect(playbackCommandSchema.safeParse({ ...base, type: 'setVolume', volume: 1.1 }).success).toBe(false);
        expect(playbackCommandSchema.safeParse({ ...base, type: 'play', itemId: 'item-1', videoId, position: -1 }).success).toBe(false);
    });
});

describe('playback event protocol', () => {
    it('accepts sequenced lifecycle events with matching command generation', () => {
        const event: PlaybackEvent = {
            type: 'playing',
            commandId: 'cmd-1',
            roomId: 'room-1',
            sequence: 4,
            timestamp: 1710000001000,
            itemId: 'item-1',
            videoId,
            position: 3,
        };

        expect(playbackEventSchema.parse(event)).toEqual(event);
    });

    it('requires positive monotonic sequence values and validates errors', () => {
        expect(playbackEventSchema.safeParse({ type: 'ready', commandId: 'cmd-1', roomId: 'room-1', sequence: 0, timestamp: 1710000000000, itemId: 'item-1', videoId }).success).toBe(false);
        expect(playbackEventSchema.safeParse({ type: 'error', commandId: 'cmd-1', roomId: 'room-1', sequence: 5, timestamp: 1710000000000, code: 'VIDEO_UNAVAILABLE', message: 'Video is unavailable', itemId: 'item-1', videoId }).success).toBe(true);
    });

    it('rejects missing command generations and noncanonical playback IDs', () => {
        const event = { type: 'playing', commandId: 'cmd-1', roomId: 'room-1', sequence: 1, timestamp: 1, itemId: 'item-1', videoId };
        expect(playbackEventSchema.safeParse({ ...event, commandId: undefined }).success).toBe(false);
        expect(playbackEventSchema.safeParse({ ...event, itemId: ' item-1' }).success).toBe(false);
        expect(playbackEventSchema.safeParse({ ...event, videoId: 'short' }).success).toBe(false);
    });
});
