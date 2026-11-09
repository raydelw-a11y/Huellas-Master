import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ command }) => {
  const now = new Date();
  const buildTime = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const buildDate = now.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const buildVersionId = `${buildDate.slice(0, 2)}${buildDate.slice(3, 5)}${String(
    now.getHours()
  ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(command === 'build' ? [viteSingleFile()] : []),
      {
        name: 'inject-build-version-meta',
        transformIndexHtml(html) {
          return html
            .replace(
              /(<meta\s+name="app-build-version"\s+content=")[^"]+("\s*\/?>)/i,
              `$1${buildVersionId}$2`
            )
            .replace(
              /(var\s+CURRENT_BUILD\s*=\s*')[^']+(';)/i,
              `$1${buildVersionId}$2`
            );
        },
      },
    ],
    define: command === 'build'
      ? {
          __BUILD_TIMESTAMP__: JSON.stringify(`${buildTime} - ${buildDate}`),
        }
      : {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      watch: {
        ignored: ['**/data/**', '**/dist/**', '**/docs/**', '**/chrome-extension/**', '**/*.log'],
      },
    },
  };
});
