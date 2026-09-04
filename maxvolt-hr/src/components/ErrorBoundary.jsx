import React from 'react';

// Matches the handful of ways browsers phrase a failed lazy-route chunk
// fetch after a deploy replaces dist/ with new content-hashed filenames —
// used only to tailor the message below, never to trigger a reload on its
// own (see the note in componentDidCatch).
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed/i;

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Render error:', error, info);
    // Previously auto-reloaded once here for a stale-chunk error (after a
    // deploy replaces dist/ with new content-hashed filenames). This app
    // deploys several times a day, and on the native shell — which pulls its
    // UI live from the server rather than a bundled build — that meant the
    // page could reload itself with zero warning mid check-in, mid form,
    // mid anything, repeatedly on a heavy deploy day. Never do that: always
    // fall through to the screen below and require an explicit tap.
  }

  render() {
    if (this.state.hasError) {
      const isChunkError = CHUNK_ERROR_RE.test(this.state.error?.message || '');
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            {isChunkError ? 'A new version is available' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-gray-500 mb-4 max-w-sm">
            {isChunkError
              ? 'This page was updated since it was loaded. Reload to get the latest version.'
              : (this.state.error?.message || 'An unexpected error occurred loading this page.')}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
