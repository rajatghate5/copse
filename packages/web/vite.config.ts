import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev the client runs on 5173 and the server on 4040. Proxying /api and /ws
// to the server keeps everything same-origin, so the session cookie the login
// sets is sent back on the WebSocket upgrade. In production one Bun process
// serves this built client and the socket from the same origin, so no proxy is
// needed and these relative paths just work.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4040', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4040', ws: true },
    },
  },
});
