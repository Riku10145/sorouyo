import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Keep min-width queries compatible with older iOS/LINE WebViews.
  build: { cssTarget: 'safari15' },
});
