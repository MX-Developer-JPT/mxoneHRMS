import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

// Shown when the server can't be reached at all (network drop, backend
// cold-start) — distinct from "session expired" because the token is still
// valid; the user should retry, not be sent through the login screen.
const NetworkErrorFallback = ({ message, onRetry }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50 px-6">
    <div className="max-w-sm w-full text-center">
      <p className="text-slate-700 font-medium mb-4">{message || 'Could not reach the server.'}</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
      >
        Retry
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
