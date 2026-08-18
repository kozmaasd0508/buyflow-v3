import { defineConfig } from 'vite';

const buildCommit = process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA ?? 'local';

export default defineConfig({
  // Relative asset paths keep the exact same build portable between
  // the Render browser preview (/app/) and Capacitor's Android WebView.
  base: './',
  plugins: [
    {
      name: 'buyflow-build-commit',
      transformIndexHtml(html) {
        return html.replace(
          '<head>',
          `<head>\n    <meta name="buyflow-build-commit" content="${buildCommit}" />`,
        );
      },
    },
  ],
});
