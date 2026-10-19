import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// P4-SEC (PR-SEC-043): режим сборки. По умолчанию — демо-стенд (быстрый вход, демо-пароль, подсказки кодов).
// Промышленная сборка: VITE_XB_MODE=production npm run build -w @xb/web — без демо-входа и тестовых подсказок.
const mode = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_XB_MODE === 'production' ? 'production' : 'demo';

export default defineConfig({
  plugins: [react()],
  define: { __XB_MODE__: JSON.stringify(mode) },
  server: { port: 5173, open: true },
});
