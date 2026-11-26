import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

const persistState = process.env.SOROUYO_PERSIST_STATE;

export default defineConfig({
  plugins: [react(), cloudflare(persistState ? { persistState: { path: persistState } } : {})],
  build: { cssTarget: ['safari15', 'ios15'] },
});
