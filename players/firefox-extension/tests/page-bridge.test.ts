import { describe, expect, it, vi } from 'vitest';

import { loadVideoInPage, type YouTubePageAdapter } from '../src/page-bridge';

describe('YouTube page-context loader', () => {
    it('dispatches yt-navigate and verifies both URL and player identity', async () => {
        let videoId = 'M7lc1UVf-VE';
        let href = `https://www.youtube.com/watch?v=${videoId}`;
        const dispatchNavigate = vi.fn((target: string, position: number) => {
            expect(position).toBe(12);
            videoId = target;
            href = `https://www.youtube.com/watch?v=${target}`;
            return true;
        });
        const fullscreen = { player: true };
        const adapter: YouTubePageAdapter = {
            dispatchNavigate,
            getVideoId: () => videoId,
            getHref: () => href,
            loadVideoById: vi.fn(),
            replaceWatchUrl: vi.fn(),
            syncMetadata: vi.fn(),
            getFullscreenElement: () => fullscreen,
            wait: async () => undefined,
        };

        await expect(loadVideoInPage({ type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: 12 }, adapter, 2)).resolves.toEqual({
            ok: true, mode: 'yt-navigate', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true,
        });
        expect(dispatchNavigate).toHaveBeenCalledWith('dQw4w9WgXcQ', 12);
        expect(adapter.loadVideoById).not.toHaveBeenCalled();
        expect(adapter.syncMetadata).toHaveBeenCalledWith('dQw4w9WgXcQ');
    });

    it('falls back to player loadVideoById and updates the watch URL', async () => {
        let videoId = 'M7lc1UVf-VE';
        let href = `https://www.youtube.com/watch?v=${videoId}`;
        const fullscreen = { player: true };
        const adapter: YouTubePageAdapter = {
            dispatchNavigate: vi.fn(() => false),
            getVideoId: () => videoId,
            getHref: () => href,
            loadVideoById: vi.fn((target) => { videoId = target; return true; }),
            replaceWatchUrl: vi.fn((target) => { href = `https://www.youtube.com/watch?v=${target}`; }),
            syncMetadata: vi.fn(),
            getFullscreenElement: () => fullscreen,
            wait: async () => undefined,
        };
        await expect(loadVideoInPage({ type: 'loadVideo', videoId: 'dQw4w9WgXcQ', position: 3 }, adapter, 1)).resolves.toEqual({
            ok: true, mode: 'player-api', videoId: 'dQw4w9WgXcQ', fullscreenRetained: true,
        });
        expect(adapter.loadVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ', 3);
        expect(adapter.replaceWatchUrl).toHaveBeenCalledWith('dQw4w9WgXcQ');
        expect(adapter.syncMetadata).toHaveBeenCalledWith('dQw4w9WgXcQ');
    });
});
