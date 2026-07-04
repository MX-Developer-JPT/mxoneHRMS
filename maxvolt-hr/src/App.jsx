import { Suspense, useState, useEffect } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from 'sonner'
import AiStatusBanner from '@/components/AiStatusBanner'
import { ThemeProvider } from 'next-themes'
import { motion } from 'framer-motion'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import { base44 } from '@/api/base44Client';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AttendanceReports from './pages/AttendanceReports';
import AttendanceRegularisation from './pages/AttendanceRegularisation';
import AttendanceExemption from './pages/AttendanceExemption';
import RegularisationApproval from './pages/RegularisationApproval';
import ConfirmationManagement from './pages/ConfirmationManagement';
import EmployeeDocuments from './pages/EmployeeDocuments';
import OnboardingForm from './pages/OnboardingForm';
import HelpdeskCategoryManagement from './pages/HelpdeskCategoryManagement';
import ShiftManagement from './pages/ShiftManagement';
import DepartmentManagement from './pages/DepartmentManagement';
import HolidayCalendar from './pages/HolidayCalendar';
import AnnouncementManagement from './pages/AnnouncementManagement';
import Dashboard from './pages/Dashboard';
import MISDashboard from './pages/MISDashboard';
import InsuranceManagement from './pages/InsuranceManagement';
import MyInsurance from './pages/MyInsurance';
import OnboardingApproval from './pages/OnboardingApproval';
import PublicJobBoard from './pages/PublicJobBoard';
import ApplyForJob from './pages/ApplyForJob';
import CareersPage from './pages/CareersPage';
import OfferAcceptPage from './pages/OfferAcceptPage';
import LOPConfiguration from './pages/LOPConfiguration';
import MyExit from './pages/MyExit';
import ExitManagement from './pages/ExitManagement';
import TrainingManagement from './pages/TrainingManagement';
import TrainingDetail from './pages/TrainingDetail';
import TrainingCalendar from './pages/TrainingCalendar';
import TrainingNeeds from './pages/TrainingNeeds';
import MyTraining from './pages/MyTraining';
import EmployeeEngagementPortal from './pages/EmployeeEngagementPortal';
import GatePassRequest from './pages/GatePassRequest';
import GatePassApproval from './pages/GatePassApproval';
import GateAdminDashboard from './pages/GateAdminDashboard';
import GatePassManagement from './pages/GatePassManagement';
import GateAdminProfile from './pages/GateAdminProfile';
import GateAdminLayout from './components/GateAdminLayout';
import RoleBasedRedirect from './components/RoleBasedRedirect';
import AskMax from './pages/AskMax';
import { pushSupported, getPushState, enablePush } from '@/utils/pwa';
import ComplianceDashboard from './pages/ComplianceDashboard';
import PerformanceManagement from './pages/PerformanceManagement';
import ImportEmployees from './pages/ImportEmployees';
import PIPManagement from './pages/PIPManagement';
import PMSConfiguration from './pages/PMSConfiguration';
import BusinessCardAdmin from './pages/BusinessCardAdmin';
import PublicBusinessCard from './pages/PublicBusinessCard';
import AttendanceLogDashboard from './pages/AttendanceLogDashboard';
import CompanyPolicies from './pages/CompanyPolicies';
import AppSettings from './pages/AppSettings';
import AdminPanel from './pages/AdminPanel';
import LeaveDashboard from './pages/LeaveDashboard';
import LocationMaster from './pages/LocationMaster';
import AssetTracking from './pages/AssetTracking';
import MyAssets from './pages/MyAssets';
import TeamCalendar from './pages/TeamCalendar';
import TaxDeclaration from './pages/TaxDeclaration';


const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.15 } },
};

const tabVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

const TAB_PAGES = ['Dashboard', 'MarkAttendance', 'Leave', 'Profile', 'MISDashboard', 'AllAttendance'];

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
  </div>
);

const AnimatedPage = ({ children, pageName }) => {
  const variants = TAB_PAGES.includes(pageName) ? tabVariants : pageVariants;
  return (
    <motion.div
      key={pageName}
      variants={variants}
      initial="initial"
      animate="animate"
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </motion.div>
  );
};

const LayoutWrapper = ({ children, currentPageName }) => {
  const content = (
    <ErrorBoundary key={currentPageName}>
      <Suspense fallback={<PageLoader />}>
        <AnimatedPage pageName={currentPageName}>{children}</AnimatedPage>
      </Suspense>
    </ErrorBoundary>
  );
  return Layout ? <Layout currentPageName={currentPageName}>{content}</Layout> : content;
};

// ── Forced password change screen (shown to bulk-imported employees on first login) ──
const ForceChangePassword = ({ onDone }) => {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pwd.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (pwd !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('base44_access_token');
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ new_password: pwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      onDone();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Set Your Password</h2>
          <p className="text-sm text-slate-500 mt-1">You are using a default password. Please set a new personal password to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password" value={pwd} onChange={e => setPwd(e.target.value)} required minLength={6}
              placeholder="Min. 6 characters"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
            <input
              type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
              placeholder="Re-enter password"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

const PUBLIC_PATHS = ['/PublicJobBoard', '/ApplyForJob', '/PublicBusinessCard', '/careers', '/career', '/offer-accept'];

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, user, checkAppState } = useAuth();
  const isPublicPath = PUBLIC_PATHS.some(p => window.location.pathname.startsWith(p));

  // Auto-request push notification permission after login (production only, after 4s delay)
  useEffect(() => {
    if (!user || isPublicPath || !pushSupported()) return;
    const timer = setTimeout(async () => {
      try {
        const state = await getPushState();
        if (state === 'default') await enablePush();
      } catch { /* user denied or push not configured — silent */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [!!user]); // eslint-disable-line react-hooks/exhaustive-deps

  if ((isLoadingPublicSettings || isLoadingAuth) && !isPublicPath) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
  }

  return (
    <>
    {user?.must_change_password && (
      <ForceChangePassword onDone={() => checkAppState()} />
    )}
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* All protected app routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
      <Route path="/" element={<RoleBasedRedirect />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/AttendanceReports" element={
        <LayoutWrapper currentPageName="AttendanceReports">
          <AttendanceReports />
        </LayoutWrapper>
      } />
      <Route path="/ShiftManagement" element={
        <LayoutWrapper currentPageName="ShiftManagement">
          <ShiftManagement />
        </LayoutWrapper>
      } />
      <Route path="/DepartmentManagement" element={
        <LayoutWrapper currentPageName="DepartmentManagement">
          <DepartmentManagement />
        </LayoutWrapper>
      } />
      <Route path="/HolidayCalendar" element={
        <LayoutWrapper currentPageName="HolidayCalendar">
          <HolidayCalendar />
        </LayoutWrapper>
      } />
      <Route path="/AnnouncementManagement" element={
        <LayoutWrapper currentPageName="AnnouncementManagement">
          <AnnouncementManagement />
        </LayoutWrapper>
      } />
      <Route path="/OnboardingForm" element={<OnboardingForm />} />
      <Route path="/OnboardingApproval" element={
        <LayoutWrapper currentPageName="OnboardingApproval">
          <OnboardingApproval />
        </LayoutWrapper>
      } />
      <Route path="/HelpdeskCategoryManagement" element={
        <LayoutWrapper currentPageName="HelpdeskCategoryManagement">
          <HelpdeskCategoryManagement />
        </LayoutWrapper>
      } />
      <Route path="/EmployeeDocuments" element={
        <LayoutWrapper currentPageName="EmployeeDocuments">
          <EmployeeDocuments />
        </LayoutWrapper>
      } />
      <Route path="/AttendanceRegularisation" element={
        <LayoutWrapper currentPageName="AttendanceRegularisation">
          <AttendanceRegularisation />
        </LayoutWrapper>
      } />
      <Route path="/RegularisationApproval" element={
        <LayoutWrapper currentPageName="RegularisationApproval">
          <RegularisationApproval />
        </LayoutWrapper>
      } />
      <Route path="/ConfirmationManagement" element={
        <LayoutWrapper currentPageName="ConfirmationManagement">
          <ConfirmationManagement />
        </LayoutWrapper>
      } />
      <Route path="/AttendanceExemption" element={
        <LayoutWrapper currentPageName="AttendanceExemption">
          <AttendanceExemption />
        </LayoutWrapper>
      } />
      <Route path="/MISDashboard" element={
        <LayoutWrapper currentPageName="MISDashboard">
          <MISDashboard />
        </LayoutWrapper>
      } />
      <Route path="/InsuranceManagement" element={
        <LayoutWrapper currentPageName="InsuranceManagement">
          <InsuranceManagement />
        </LayoutWrapper>
      } />
      <Route path="/MyInsurance" element={
        <LayoutWrapper currentPageName="MyInsurance">
          <MyInsurance />
        </LayoutWrapper>
      } />
      <Route path="/LOPConfiguration" element={
        <LayoutWrapper currentPageName="LOPConfiguration">
          <LOPConfiguration />
        </LayoutWrapper>
      } />

      <Route path="/MyExit" element={
        <LayoutWrapper currentPageName="MyExit">
          <MyExit />
        </LayoutWrapper>
      } />
      <Route path="/ExitManagement" element={
        <LayoutWrapper currentPageName="ExitManagement">
          <ExitManagement />
        </LayoutWrapper>
      } />
      <Route path="/TrainingManagement" element={
        <LayoutWrapper currentPageName="TrainingManagement">
          <TrainingManagement />
        </LayoutWrapper>
      } />
      <Route path="/TrainingDetail" element={
        <LayoutWrapper currentPageName="TrainingDetail">
          <TrainingDetail />
        </LayoutWrapper>
      } />
      <Route path="/TrainingCalendar" element={
        <LayoutWrapper currentPageName="TrainingCalendar">
          <TrainingCalendar />
        </LayoutWrapper>
      } />
      <Route path="/TrainingNeeds" element={
        <LayoutWrapper currentPageName="TrainingNeeds">
          <TrainingNeeds />
        </LayoutWrapper>
      } />
      <Route path="/MyTraining" element={
        <LayoutWrapper currentPageName="MyTraining">
          <MyTraining />
        </LayoutWrapper>
      } />
      <Route path="/EmployeeEngagementPortal" element={
        <LayoutWrapper currentPageName="EmployeeEngagementPortal">
          <EmployeeEngagementPortal />
        </LayoutWrapper>
      } />
      <Route path="/GatePassRequest" element={
        <LayoutWrapper currentPageName="GatePassRequest">
          <GatePassRequest />
        </LayoutWrapper>
      } />
      <Route path="/GatePassApproval" element={
        <LayoutWrapper currentPageName="GatePassApproval">
          <GatePassApproval />
        </LayoutWrapper>
      } />
      <Route path="/GateAdminDashboard" element={
        <GateAdminLayout currentPageName="GateAdminDashboard">
          <GateAdminDashboard />
        </GateAdminLayout>
      } />
      <Route path="/GatePassManagement" element={
        <LayoutWrapper currentPageName="GatePassManagement">
          <GatePassManagement />
        </LayoutWrapper>
      } />
      <Route path="/GateAdminProfile" element={
        <GateAdminLayout currentPageName="GateAdminProfile">
          <GateAdminProfile />
        </GateAdminLayout>
      } />
      <Route path="/PerformanceManagement" element={
        <LayoutWrapper currentPageName="PerformanceManagement">
          <PerformanceManagement />
        </LayoutWrapper>
      } />
      <Route path="/PIPManagement" element={
        <LayoutWrapper currentPageName="PIPManagement">
          <PIPManagement />
        </LayoutWrapper>
      } />
      <Route path="/PMSConfiguration" element={
        <LayoutWrapper currentPageName="PMSConfiguration">
          <PMSConfiguration />
        </LayoutWrapper>
      } />
      <Route path="/ComplianceDashboard" element={
        <LayoutWrapper currentPageName="ComplianceDashboard">
          <ComplianceDashboard />
        </LayoutWrapper>
      } />
      <Route path="/AskMax" element={
        <LayoutWrapper currentPageName="AskMax">
          <AskMax />
        </LayoutWrapper>
      } />
      <Route path="/ImportEmployees" element={
        <LayoutWrapper currentPageName="ImportEmployees">
          <ImportEmployees />
        </LayoutWrapper>
      } />
      <Route path="/BusinessCardAdmin" element={
        <LayoutWrapper currentPageName="BusinessCardAdmin">
          <BusinessCardAdmin />
        </LayoutWrapper>
      } />
      <Route path="/AttendanceLogDashboard" element={
        <LayoutWrapper currentPageName="AttendanceLogDashboard">
          <AttendanceLogDashboard />
        </LayoutWrapper>
      } />
      <Route path="/CompanyPolicies" element={
        <LayoutWrapper currentPageName="CompanyPolicies">
          <CompanyPolicies />
        </LayoutWrapper>
      } />
      <Route path="/AppSettings" element={
        <LayoutWrapper currentPageName="AppSettings">
          <AppSettings />
        </LayoutWrapper>
      } />
      <Route path="/AdminPanel" element={
        <LayoutWrapper currentPageName="AdminPanel">
          <AdminPanel />
        </LayoutWrapper>
      } />
      <Route path="/LeaveDashboard" element={
        <LayoutWrapper currentPageName="LeaveDashboard">
          <LeaveDashboard />
        </LayoutWrapper>
      } />
      <Route path="/LocationMaster" element={
        <LayoutWrapper currentPageName="LocationMaster">
          <LocationMaster />
        </LayoutWrapper>
      } />
      <Route path="/AssetTracking" element={
        <LayoutWrapper currentPageName="AssetTracking">
          <AssetTracking />
        </LayoutWrapper>
      } />
      <Route path="/MyAssets" element={
        <LayoutWrapper currentPageName="MyAssets">
          <MyAssets />
        </LayoutWrapper>
      } />
      <Route path="/TeamCalendar" element={
        <LayoutWrapper currentPageName="TeamCalendar">
          <TeamCalendar />
        </LayoutWrapper>
      } />
      <Route path="/TaxDeclaration" element={
        <LayoutWrapper currentPageName="TaxDeclaration">
          <TaxDeclaration />
        </LayoutWrapper>
      } />
      </Route>{/* end ProtectedRoute */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};


function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <Routes>
          {/* Public routes - no login required */}
          <Route path="/PublicJobBoard" element={<PublicJobBoard />} />
          <Route path="/ApplyForJob" element={<ApplyForJob />} />
          <Route path="/PublicBusinessCard" element={<PublicBusinessCard />} />
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/careers/:jobId" element={<CareersPage />} />
          <Route path="/career" element={<CareersPage />} />
          <Route path="/career/:jobId" element={<CareersPage />} />
          <Route path="/offer-accept/:token" element={<OfferAcceptPage />} />
          {/* All other routes go through auth */}
          <Route path="*" element={
            <AuthProvider>
              <AuthenticatedApp />
            </AuthProvider>
          } />
        </Routes>
      </Router>
      <Toaster />
      <SonnerToaster richColors position="top-right" />
      <AiStatusBanner />
    </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App