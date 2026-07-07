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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

// Register the service worker for PWA install + offline + push (production only)
if (import.meta.env.PROD) {
  window.addEventListener('load', () => { registerServiceWorker() })
}
