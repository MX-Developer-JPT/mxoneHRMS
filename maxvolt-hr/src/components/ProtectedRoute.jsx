import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

// Shown when the server can't be reached at all (client offline, network
// drop, backend cold-start) — distinct from "session expired" because the
// token is still valid; the user should retry, not be sent through the
// login screen. A full page reload (not just re-running the auth check) is
// deliberate here: it's the most robust recovery from whatever state the
// app was in when connectivity dropped, and matches what a plain "please
// check your internet" prompt is expected to offer.
const NetworkErrorFallback = ({ message, onRetry }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6">
    <div className="max-w-sm w-full text-center">
      <p className="text-slate-900 font-semibold text-lg mb-1.5">Please check your internet connection</p>
      <p className="text-slate-500 text-sm mb-5">{message || 'Could not reach the server.'}</p>
      <button
        onClick={() => { onRetry?.(); window.location.reload(); }}
        className="px-5 py-2.5 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
      >
        Reload
      </button>
    </div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const { isAuthenticated, isLoadingAuth, authError, checkAppState } = useAuth();

  if (isLoadingAuth) {
    return fallback;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    if (authError.type === 'network_error') {
      return <NetworkErrorFallback message={authError.message} onRetry={checkAppState} />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  return <Outlet />;
}
