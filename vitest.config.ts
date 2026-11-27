import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['{frontend/src,backend/src,shared}/**/*.test.ts'] } });
