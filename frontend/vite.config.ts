import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard talks to the backend through same-origin paths; Vite proxies them in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: false },
      '/files': { target: 'http://localhost:4100', changeOrigin: false },
    },
  },
});
