import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from 'sonner'
import AiStatusBanner from '@/components/AiStatusBanner'
import { ThemeProvider } from 'next-themes'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AttendanceReports from './pages/AttendanceReports';
import AttendanceRegularisation from './pages/AttendanceRegularisation';
import AttendanceExemption from './pages/AttendanceExemption';
import RegularisationApproval from './pages/RegularisationApproval';
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

const AnimatedPage = ({ children, pageName }) => {
  const variants = TAB_PAGES.includes(pageName) ? tabVariants : pageVariants;
  return (
    <motion.div
      key={pageName}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </motion.div>
  );
};

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}><AnimatedPage pageName={currentPageName}>{children}</AnimatedPage></Layout>
  : <AnimatedPage pageName={currentPageName}>{children}</AnimatedPage>;

const PUBLIC_PATHS = ['/PublicJobBoard', '/ApplyForJob', '/PublicBusinessCard', '/careers', '/career', '/offer-accept'];

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();
  const location = useLocation();
  const isPublicPath = PUBLIC_PATHS.some(p => window.location.pathname.startsWith(p));

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
    <AnimatePresence mode="wait">
    <Routes location={location} key={location.pathname}>
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
    </AnimatePresence>
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