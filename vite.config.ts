import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts'; if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'; } } } },
});
