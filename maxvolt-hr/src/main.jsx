import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerServiceWorker } from '@/utils/pwa'

// A lazy-loaded route chunk can 404 after a new deploy replaces dist/ with
// fresh content-hashed filenames while this tab still references the old
// ones ("Failed to fetch dynamically imported module"). Vite fires this
// event in that exact case — reload once to pick up the new build. The
// sessionStorage guard prevents a reload loop if the failure is a genuine
// network/offline issue rather than a stale deploy.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (!sessionStorage.getItem('vite_reload_once')) {
    sessionStorage.setItem('vite_reload_once', '1');
    window.location.reload();
  }
});

// iOS Safari bug (still present as of iOS 17/18): position:fixed; bottom:0
// elements resolve against the browser's LAYOUT viewport, which reserves
// space for Safari's own bottom toolbar — even in standalone/home-screen PWA
// mode where that toolbar isn't actually shown, and even with 100dvh (dvh
// fixes height calculations, not fixed-offset resolution, in the affected
// versions). The result: a fixed bottom bar floats above the true bottom of
// the screen with a gap the height of the (hidden) toolbar beneath it.
// Fix: track window.visualViewport (the actual visible area) and expose the
// difference as a CSS var so fixed bottom elements can offset by it instead
// of assuming bottom:0 is the true screen edge.
function trackVisualViewportInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--vv-bottom-inset', `${inset}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
trackVisualViewportInset();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Register the service worker for PWA install + offline + push (production only)
if (import.meta.env.PROD) {
  window.addEventListener('load', () => { registerServiceWorker() })
}
