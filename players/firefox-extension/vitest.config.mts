import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        root: extensionRoot,
        include: ['tests/**/*.test.ts'],
        environment: 'node',
    },
});
