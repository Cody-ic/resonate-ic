import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),base:'/resonate-ic/',envDir:false,publicDir:false,
 plugins:[react()],build:{outDir:fileURLToPath(new URL('../dist-pages',import.meta.url)),emptyOutDir:true},
 server:{host:'127.0.0.1'},preview:{host:'127.0.0.1'},
});
