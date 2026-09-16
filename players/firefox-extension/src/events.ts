import { playbackEventSchema, type PlaybackEvent } from '../../../packages/playback-protocol/src';

export type ContentEvent = {
    type: string;
    position?: number;
    code?: string;
    message?: string;
};

type MappedContentEvent = {
    type: PlaybackEvent['type'];
    position?: number;
    code?: string;
    message?: string;
};

const DOM_EVENT_TYPES: Record<string, MappedContentEvent['type']> = {
    loadedmetadata: 'ready',
    ready: 'ready',
    loading: 'loading',
    playing: 'playing',
    pause: 'paused',
    paused: 'paused',
    ended: 'ended',
    error: 'error',
};

export function mapDomEvent(event: ContentEvent): MappedContentEvent | null {
    const type = DOM_EVENT_TYPES[event.type];
    if (!type) return null;
    if (type === 'error') {
        if (!event.code || !event.message) return null;
        return { type, position: event.position, code: event.code, message: event.message };
    }
    return { type, position: event.position };
}

export function enrichContentEvent(
    input: ContentEvent,
    active: { roomId?: string; itemId?: string; videoId?: string },
    previousSequence: number,
    timestamp: number,
): PlaybackEvent | null {
    const mapped = mapDomEvent(input);
    if (!mapped || !active.roomId || !active.itemId || !active.videoId) return null;
    const event = {
        ...mapped,
        roomId: active.roomId,
        itemId: active.itemId,
        videoId: active.videoId,
        sequence: Math.max(1, previousSequence + 1),
        timestamp,
    };
    return playbackEventSchema.parse(event);
}
