import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 3100, proxy: { '/api': { target: 'http://127.0.0.1:3101', changeOrigin: false } } }, build: { target: 'es2022' } });
