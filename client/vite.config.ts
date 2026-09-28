import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin runs the game Worker + Durable Objects inside the dev
// server (so /api and /ws work locally) and builds client + Worker for deploy.
export default defineConfig({
  plugins: [react(), cloudflare({ configPath: '../wrangler.jsonc' })],
  server: {
    port: 5173,
    strictPort: true,
  },
});
