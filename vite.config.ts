import { defineConfig } from 'vite';

// GitHub Pages のサブパス（/<repo>/）でも動くよう相対パスでビルド
export default defineConfig({
  base: './',
});
