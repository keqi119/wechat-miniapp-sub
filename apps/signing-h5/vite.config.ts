import { defineConfig } from 'vite';
export default defineConfig({
  base: '/miniapp-sign/',
  server: { port: 3102, strictPort: true, proxy: { '/miniapp-sign/api': { target: 'http://127.0.0.1:3101', changeOrigin: false, rewrite: path => path.replace(/^\/miniapp-sign\/api/, '/api/h5-sign') } } },
  build: { target: 'es2022' }
});
