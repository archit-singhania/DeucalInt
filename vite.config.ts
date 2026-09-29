import { defineConfig } from 'vite';
export default defineConfig({root:'apps/dashboard',server:{port:4200,proxy:{'/api':'http://127.0.0.1:8100','/v1':'http://127.0.0.1:8100','/health':'http://127.0.0.1:8100','/metrics':'http://127.0.0.1:8100'}},build:{outDir:'../../dist/dashboard',emptyOutDir:true},resolve:{conditions:['browser','module','development']}});
