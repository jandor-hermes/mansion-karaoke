import { z } from 'zod';

const nonEmptyString = z.string().min(1).refine((value) => value === value.trim(), 'must be canonical');
export const itemIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const timestamp = z.number().finite().int().nonnegative();
const sequence = z.number().int().positive();

const commandBase = z.object({
    commandId: nonEmptyString,
    roomId: nonEmptyString,
    issuedAt: timestamp,
});

export const playbackCommandSchema = z.discriminatedUnion('type', [
    commandBase.extend({
        type: z.literal('play'),
        itemId: itemIdSchema,
        videoId: videoIdSchema,
        position: z.number().finite().nonnegative().default(0),
    }),
    commandBase.extend({ type: z.literal('pause') }),
    commandBase.extend({ type: z.literal('resume') }),
    commandBase.extend({ type: z.literal('skip') }),
    commandBase.extend({
        type: z.literal('setVolume'),
        volume: z.number().finite().min(0).max(1),
    }),
    commandBase.extend({ type: z.literal('fullscreen') }),
]);

const eventBase = z.object({
    commandId: nonEmptyString,
    roomId: nonEmptyString,
    sequence,
    timestamp,
});

const itemEvent = eventBase.extend({
    itemId: itemIdSchema,
    videoId: videoIdSchema,
    position: z.number().finite().nonnegative().optional(),
});

export const playbackEventSchema = z.discriminatedUnion('type', [
    itemEvent.extend({ type: z.literal('ready') }),
    itemEvent.extend({ type: z.literal('loading') }),
    itemEvent.extend({ type: z.literal('playing') }),
    itemEvent.extend({ type: z.literal('paused') }),
    itemEvent.extend({ type: z.literal('ended') }),
    eventBase.extend({
        type: z.literal('error'),
        code: nonEmptyString,
        message: nonEmptyString,
        itemId: itemIdSchema,
        videoId: videoIdSchema,
    }),
]);

export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;
export type PlaybackEvent = z.infer<typeof playbackEventSchema>;
