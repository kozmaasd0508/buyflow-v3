import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths keep the exact same build portable between
  // the Render browser preview (/app/) and Capacitor's Android WebView.
  base: './',
});
