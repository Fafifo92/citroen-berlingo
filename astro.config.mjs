// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://symphonious-cascaron-d57286.netlify.app',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});