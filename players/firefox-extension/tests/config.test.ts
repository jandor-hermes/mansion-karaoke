import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTROLLER_URL, parseStoredConfig } from '../src/config';

describe('extension configuration', () => {
    it('uses the loopback controller and empty token when storage is empty', () => {
        expect(parseStoredConfig(undefined)).toEqual({ baseUrl: DEFAULT_CONTROLLER_URL, token: '' });
    });

    it('accepts stored controller URL and bearer token strings', () => {
        expect(parseStoredConfig({ baseUrl: 'http://controller.test/', token: '  abc  ' })).toEqual({
            baseUrl: 'http://controller.test/', token: '  abc  ',
        });
    });

    it('ignores malformed stored values without exposing a secret', () => {
        expect(parseStoredConfig({ baseUrl: 42, token: null })).toEqual({ baseUrl: DEFAULT_CONTROLLER_URL, token: '' });
    });
});
