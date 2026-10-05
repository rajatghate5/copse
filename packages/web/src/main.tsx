import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App.tsx';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Register the service worker, which is what makes Copse installable. Only in a
 * built client: in dev it would sit in front of Vite's module graph and serve
 * yesterday's modules. Registered after load so it never competes with the
 * first render, and a failure is ignored - the app does not need it to run.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* unsupported, blocked, or a private window: nothing to do */
    });
  });
}
