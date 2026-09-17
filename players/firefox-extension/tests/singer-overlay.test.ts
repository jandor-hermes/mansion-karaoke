import { describe, expect, it } from 'vitest';

import { DEFAULT_OVERLAY_SETTINGS, parseOverlaySettings } from '../src/config';
import { singerLabel, upNextVisible, type OverlayInfo } from '../src/singer-overlay';

const info = (overrides: Partial<OverlayInfo> = {}): OverlayInfo => ({
    current: { title: 'Song A', requestedBy: 'Sarah' },
    next: { title: 'Bohemian Rhapsody', requestedBy: 'Mike' },
    playing: true,
    remainingSeconds: null,
    ...overrides,
});

describe('singer label derivation', () => {
    it('combines requester and title', () => {
        expect(singerLabel({ requestedBy: 'Sarah', title: 'Song A' })).toBe('Sarah — Song A');
    });
    it('falls back to requester only, then title only, then empty', () => {
        expect(singerLabel({ requestedBy: 'Sarah' })).toBe('Sarah');
        expect(singerLabel({ title: 'Song A' })).toBe('Song A');
        expect(singerLabel({})).toBe('');
        expect(singerLabel(null)).toBe('');
    });
});

describe('up next visibility', () => {
    it('shows during the configured window before the end', () => {
        expect(upNextVisible(info({ remainingSeconds: 20 }), { ...DEFAULT_OVERLAY_SETTINGS, upNextSeconds: 20 })).toBe(true);
        expect(upNextVisible(info({ remainingSeconds: 21 }), { ...DEFAULT_OVERLAY_SETTINGS, upNextSeconds: 20 })).toBe(false);
        expect(upNextVisible(info({ remainingSeconds: 5 }), { ...DEFAULT_OVERLAY_SETTINGS, upNextSeconds: 30 })).toBe(true);
    });
    it('always-on mode ignores the timer and playing state', () => {
        expect(upNextVisible(info({ playing: false, remainingSeconds: null }), { ...DEFAULT_OVERLAY_SETTINGS, upNextAlways: true })).toBe(true);
    });
    it('zero seconds disables the timed card', () => {
        expect(upNextVisible(info({ remainingSeconds: 1 }), { ...DEFAULT_OVERLAY_SETTINGS, upNextSeconds: 0 })).toBe(false);
    });
    it('never shows without a next item or label', () => {
        expect(upNextVisible(info({ next: null }), DEFAULT_OVERLAY_SETTINGS)).toBe(false);
        expect(upNextVisible(info({ next: {} }), { ...DEFAULT_OVERLAY_SETTINGS, upNextAlways: true })).toBe(false);
    });
});

describe('overlay settings parsing', () => {
    it('returns defaults for empty or malformed storage', () => {
        expect(parseOverlaySettings(undefined)).toEqual(DEFAULT_OVERLAY_SETTINGS);
        expect(parseOverlaySettings('junk')).toEqual(DEFAULT_OVERLAY_SETTINGS);
    });
    it('clamps the seconds window into a sane range', () => {
        expect(parseOverlaySettings({ upNextSeconds: -5 }).upNextSeconds).toBe(0);
        expect(parseOverlaySettings({ upNextSeconds: 99 }).upNextSeconds).toBe(99);
        expect(parseOverlaySettings({ upNextSeconds: 99999 }).upNextSeconds).toBe(600);
        expect(parseOverlaySettings({ upNextSeconds: '20' }).upNextSeconds).toBe(DEFAULT_OVERLAY_SETTINGS.upNextSeconds);
    });
    it('preserves explicit boolean choices', () => {
        expect(parseOverlaySettings({ nowSinging: false, upNextAlways: true })).toEqual({ nowSinging: false, upNextSeconds: 20, upNextAlways: true });
    });
});
