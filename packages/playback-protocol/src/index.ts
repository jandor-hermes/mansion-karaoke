import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
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
        itemId: nonEmptyString,
        videoId: nonEmptyString,
        position: z.number().finite().nonnegative().default(0),
    }),
    commandBase.extend({ type: z.literal('pause') }),
    commandBase.extend({ type: z.literal('resume') }),
    commandBase.extend({ type: z.literal('skip') }),
    commandBase.extend({
        type: z.literal('setVolume'),
        volume: z.number().finite().min(0).max(1),
    }),
]);

const eventBase = z.object({
    roomId: nonEmptyString,
    sequence,
    timestamp,
});

const itemEvent = eventBase.extend({
    itemId: nonEmptyString,
    videoId: nonEmptyString,
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
        itemId: nonEmptyString.optional(),
        videoId: nonEmptyString.optional(),
    }),
]);

export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;
export type PlaybackEvent = z.infer<typeof playbackEventSchema>;
