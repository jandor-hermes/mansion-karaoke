import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['players/firefox-extension/tests/**/*.test.ts'], environment: 'node' } });
