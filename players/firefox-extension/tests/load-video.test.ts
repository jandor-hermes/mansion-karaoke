import { describe, expect, it } from 'vitest';

import { parseLoadVideoCommand, parseLoadVideoResult, requestPageLoad } from '../src/load-video';

describe('same-document load protocol', () => {
    it('accepts only an eleven-character YouTube id and a finite nonnegative position', () => {
        expect(parseLoadVideoCommand({ type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: 7 })).toEqual({
            type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: 7,
        });
        for (const invalid of [
            { type: 'loadVideo', videoId: 'short', position: 0 },
            { type: 'loadVideo', videoId: 'dQw4w9WgXc!', position: 0 },
            { type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: -1 },
            { type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: Number.POSITIVE_INFINITY },
        ]) expect(parseLoadVideoCommand(invalid)).toBeNull();
    });

    it('accepts only a verified narrow page-bridge result', () => {
        expect(parseLoadVideoResult({ ok: true, mode: 'player-api', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true })).toEqual({
            ok: true, mode: 'player-api', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true,
        });
        expect(parseLoadVideoResult({ ok: true, mode: 'arbitrary-method', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true })).toBeNull();
        expect(parseLoadVideoResult({ ok: true, mode: 'player-api', videoId: 'wrong', fullscreenRetained: true })).toBeNull();
    });

    it('bridges a validated request and returns only the matching verified response', async () => {
        const node = new EventTarget() as EventTarget & { dataset: Record<string, string> };
        node.dataset = {};
        node.addEventListener('karaoke-load-request-testchannel', () => {
            const request = JSON.parse(node.dataset.karaokeRequest);
            expect(request).toEqual({ requestId: expect.any(String), videoId: 'dQw4w9WgXcQ', position: 9 });
            node.dataset.karaokeResponse = JSON.stringify({
                requestId: request.requestId,
                result: { ok: true, mode: 'yt-navigate', videoId: request.videoId, fullscreenRetained: true },
            });
            node.dispatchEvent(new Event('karaoke-load-response-testchannel'));
        });

        await expect(requestPageLoad(node, 'testchannel', { type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: 9 }, 50)).resolves.toEqual({
            ok: true, mode: 'yt-navigate', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true,
        });
    });
});
