import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// PORT and BASE_PATH default to sensible values for local development.
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const basePath = process.env.BASE_PATH ?? '/';

// Set API_PORT to proxy /api/* requests to the backend during local dev.
// Example: API_PORT=8080 pnpm run dev
const apiPort = process.env.API_PORT ? Number(process.env.API_PORT) : null;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    ...(apiPort
      ? {
          proxy: {
            '/api': {
              target: `http://localhost:${apiPort}`,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
