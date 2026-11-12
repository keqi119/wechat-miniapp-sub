import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig(({mode})=>({
  base: mode==='owner'?'/owner/':'/miniapp-sign/',
  plugins: mode==='owner'?[{name:'owner-entry',configureServer(server){
    server.middlewares.use((req,_res,next)=>{
      const [path,query]=String(req.url||'').split('?');
      if(['/owner/','/owner/return/','/owner/return'].includes(path))req.url='/owner/owner.html'+(query?'?'+query:'');
      next();
    });
  }}]:[],
  server: { port: 3102, strictPort: true, proxy: {
    '/miniapp-sign/api': { target: 'http://127.0.0.1:3101', changeOrigin: false, rewrite: path => path.replace(/^\/miniapp-sign\/api/, '/api/h5-sign') },
    '/owner/api': { target: 'http://127.0.0.1:3101', changeOrigin: false, rewrite: path => path.replace(/^\/owner\/api/, '/api/owner-h5') }
  } },
  build: { target: 'es2022',...(mode==='owner'?{emptyOutDir:false,rollupOptions:{input:fileURLToPath(new URL('./owner.html',import.meta.url))}}:{}) }
}));
