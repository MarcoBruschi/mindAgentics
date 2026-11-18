import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mindagentics/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules[\\/](lucide-react|clsx|tailwind-merge)[\\/]/.test(id)) {
            return 'vendor-ui';
          }
          if (/node_modules[\\/](react|react-dom|scheduler|jotai)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (/node_modules[\\/](@codemirror|@lezer|codemirror)[\\/]/.test(id)) {
            return 'vendor-codemirror';
          }
          if (/node_modules[\\/](@xterm|xterm)[\\/]/.test(id)) {
            return 'vendor-xterm';
          }
          if (/node_modules[\\/](mermaid|d3|dagre|cytoscape)[\\/]/.test(id)) {
            return 'vendor-mermaid-d3';
          }
          if (/node_modules[\\/]@tauri-apps[\\/]/.test(id)) {
            return 'vendor-tauri';
          }
          return 'vendor-misc';
        },
      },
    },
  },
});
