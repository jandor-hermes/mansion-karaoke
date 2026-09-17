import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTROLLER_URL, DEFAULT_OVERLAY_SETTINGS, parseOverlaySettings, parseStoredConfig } from '../src/config';

describe('extension configuration', () => {
    it('uses the loopback controller and empty token when storage is empty', () => {
        expect(parseStoredConfig(undefined)).toEqual({ baseUrl: DEFAULT_CONTROLLER_URL, token: '', overlay: DEFAULT_OVERLAY_SETTINGS });
    });

    it('accepts stored controller URL and bearer token strings', () => {
        expect(parseStoredConfig({ baseUrl: 'http://controller.test/', token: '  abc  ' })).toEqual({
            baseUrl: 'http://controller.test/', token: '  abc  ', overlay: DEFAULT_OVERLAY_SETTINGS,
        });
    });

    it('ignores malformed stored values without exposing a secret', () => {
        expect(parseStoredConfig({ baseUrl: 42, token: null })).toEqual({ baseUrl: DEFAULT_CONTROLLER_URL, token: '', overlay: DEFAULT_OVERLAY_SETTINGS });
    });

    it('parses stored overlay settings', () => {
        expect(parseStoredConfig({ baseUrl: 'http://c.test/', token: 't', overlay: { nowSinging: false, upNextAlways: true, upNextSeconds: 45 } })).toEqual({
            baseUrl: 'http://c.test/', token: 't', overlay: { nowSinging: false, upNextAlways: true, upNextSeconds: 45 },
        });
    });

    it('falls back to default overlay settings per field', () => {
        expect(parseStoredConfig({ overlay: { upNextSeconds: 60 } }).overlay).toEqual({ nowSinging: true, upNextSeconds: 60, upNextAlways: false });
    });

    it('overlay settings parser clamps and defaults independently', () => {
        expect(parseOverlaySettings({ upNextSeconds: 30 })).toEqual({ nowSinging: true, upNextSeconds: 30, upNextAlways: false });
        expect(parseOverlaySettings({ upNextSeconds: -1 }).upNextSeconds).toBe(0);
    });
});
