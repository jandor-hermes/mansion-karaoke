import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['packages/playback-protocol/tests/**/*.test.ts'],
        environment: 'node',
    },
});
