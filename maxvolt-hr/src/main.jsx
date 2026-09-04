import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerServiceWorker } from '@/utils/pwa'

// A lazy-loaded route chunk can 404 after a new deploy replaces dist/ with
// fresh content-hashed filenames while this tab still references the old
// ones ("Failed to fetch dynamically imported module"). This app deploys
// several times a day, and an unprompted window.location.reload() here used
// to fire the instant that happened — on a native shell pulling its UI live
// from the server (see the Capacitor note below), that meant the app could
// yank itself out from under the employee mid check-in/mid-form with no
// warning, repeatedly on a busy deploy day, reading as "the app keeps
// crashing". Never reload without the user asking for it: swallow the event
// (Vite's own unhandled-rejection default is suppressed) and let the failed
// import surface normally — React.lazy/Suspense throws, the nearest
// ErrorBoundary catches it and shows a page with an explicit "Reload Page"
// button instead of reloading on its own.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
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

// Native shell only (Capacitor). This app loads its UI over the network from
// a remote server.url rather than bundling it locally, so the native launch
// screen would otherwise disappear almost instantly (as soon as the WKWebView
// is created) and hand off to a BLANK WHITE WebView for however long the
// network fetch + first render takes — on a cold relaunch (e.g. iOS killing
// a backgrounded app that was doing background location tracking, then
// relaunching it later) with weak signal, that can be several seconds of
// blank white instead of the branded splash. launchAutoHide:false in
// capacitor.config.json keeps the native splash on screen until this code
// explicitly hides it, once the page has actually loaded.
if (window.Capacitor?.isNativePlatform?.()) {
  const hideSplash = () => {
    import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {});
  };
  window.addEventListener('load', () => requestAnimationFrame(hideSplash));
  // Bounded fallback — if 'load' never fires (e.g. genuinely offline with no
  // cached content), don't leave the user stuck on the splash forever.
  setTimeout(hideSplash, 10000);
}
