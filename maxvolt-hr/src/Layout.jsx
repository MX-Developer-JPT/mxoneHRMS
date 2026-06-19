import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Clock, Calendar, FileText, Users, CreditCard,
  Target, HelpCircle, Settings, LogOut, Menu, X, Briefcase,
  DollarSign, FolderOpen, Bell, UserPlus, TrendingDown, BarChart3,
  UserCog, Building2, ShieldOff, PieChart, Shield, GraduationCap,
  ShieldCheck, Sparkles, AlertTriangle, QrCode, ArrowLeft, User2,
  Sun, Moon, BookOpen, SlidersHorizontal, MapPin, Laptop, ChevronRight,
} from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import DashboardPage from './pages/Dashboard';
import MarkAttendancePage from './pages/MarkAttendance';
import LeavePage from './pages/Leave';
import ProfilePage from './pages/Profile';

const PERSISTENT_TABS = new Set(['Dashboard', 'MarkAttendance', 'Leave', 'Profile']);

/* ── Menu definitions ──────────────────────────────────────── */
const employeeMenuItems = [
  { name: 'Dashboard',        icon: LayoutDashboard,   page: 'Dashboard' },
  { name: 'Mark Attendance',  icon: Clock,             page: 'MarkAttendance' },
  { name: 'My Attendance',    icon: Calendar,          page: 'AttendanceHistory' },
  { name: 'Regularisation',   icon: Clock,             page: 'AttendanceRegularisation' },
  { name: 'Apply Leave',      icon: FileText,          page: 'Leave' },
  { name: 'My Payslips',      icon: CreditCard,        page: 'Payslips' },
  { name: 'Tax Declaration',  icon: FileText,          page: 'TaxDeclaration' },
  { name: 'My Documents',     icon: FolderOpen,        page: 'Documents' },
  { name: 'Expenses',         icon: DollarSign,        page: 'Reimbursements' },
  { name: 'My Performance',   icon: Target,            page: 'PerformanceManagement' },
  { name: 'Helpdesk',         icon: HelpCircle,        page: 'Helpdesk' },
  { name: 'Announcements',    icon: Bell,              page: 'Announcements' },
  { name: 'My Insurance',     icon: Shield,            page: 'MyInsurance' },
  { name: 'My Training',      icon: GraduationCap,     page: 'MyTraining' },
  { name: 'My Exit',          icon: LogOut,            page: 'MyExit' },
  { name: 'Gate Pass',        icon: ShieldCheck,       page: 'GatePassRequest' },
  { name: 'My Assets',        icon: Laptop,            page: 'MyAssets' },
  { name: 'Team Calendar',    icon: Calendar,          page: 'TeamCalendar' },
  { name: 'Employee Portal',  icon: Users,             page: 'EmployeeEngagementPortal' },
  { name: 'AskMax AI',        icon: Sparkles,          page: 'AskMax' },
  { name: 'My Profile',       icon: User2,             page: 'Profile' },
  { name: 'App Settings',     icon: SlidersHorizontal, page: 'AppSettings' },
];

const managementMenuItems = [
  { name: 'Dashboard',               icon: LayoutDashboard,   page: 'Dashboard' },
  { name: 'MIS Analytics',           icon: PieChart,          page: 'MISDashboard' },
  { name: 'Mark Attendance',         icon: Clock,             page: 'MarkAttendance' },
  { name: 'My Attendance',           icon: Calendar,          page: 'AttendanceHistory' },
  { name: 'Department Attendance',   icon: BarChart3,         page: 'AllAttendance' },
  { name: 'Regularisation Approvals',icon: Clock,             page: 'RegularisationApproval' },
  { name: 'Leave Management',        icon: FileText,          page: 'LeaveManagement' },
  { name: 'Leave Dashboard',         icon: PieChart,          page: 'LeaveDashboard' },
  { name: 'Expense Approvals',       icon: DollarSign,        page: 'Approvals' },
  { name: 'My Team',                 icon: Users,             page: 'Employees' },
  { name: 'Announcements',           icon: Bell,              page: 'Announcements' },
  { name: 'My Training',             icon: GraduationCap,     page: 'MyTraining' },
  { name: 'My Performance',          icon: Target,            page: 'PerformanceManagement' },
  { name: 'My Exit',                 icon: LogOut,            page: 'MyExit' },
  { name: 'Gate Pass Approvals',     icon: ShieldCheck,       page: 'GatePassApproval' },
  { name: 'Team Calendar',           icon: Calendar,          page: 'TeamCalendar' },
  { name: 'Job Requisitions',        icon: Briefcase,         page: 'JobRequisitions' },
  { name: 'Helpdesk',                icon: HelpCircle,        page: 'Helpdesk' },
  { name: 'Employee Portal',         icon: Users,             page: 'EmployeeEngagementPortal' },
  { name: 'AskMax AI',               icon: Sparkles,          page: 'AskMax' },
  { name: 'My Profile',              icon: User2,             page: 'Profile' },
  { name: 'App Settings',            icon: SlidersHorizontal, page: 'AppSettings' },
];

const hrMenuItems = [
  { name: 'Dashboard',               icon: LayoutDashboard,   page: 'Dashboard' },
  { name: 'MIS Analytics',           icon: PieChart,          page: 'MISDashboard' },
  { name: 'Onboarding Approval',     icon: UserPlus,          page: 'OnboardingApproval' },
  { name: 'Employee Documents',      icon: FolderOpen,        page: 'EmployeeDocuments' },
  { name: 'Employees',               icon: Users,             page: 'Employees' },
  { name: 'All Attendance',          icon: Clock,             page: 'AllAttendance' },
  { name: 'Regularisation Approvals',icon: Clock,             page: 'RegularisationApproval' },
  { name: 'Attendance Reports',      icon: BarChart3,         page: 'AttendanceReports' },
  { name: 'Biometric Logs',          icon: Clock,             page: 'AttendanceLogDashboard' },
  { name: 'Shift Management',        icon: UserCog,           page: 'ShiftManagement' },
  { name: 'Leave Management',        icon: FileText,          page: 'LeaveManagement' },
  { name: 'Leave Dashboard',         icon: PieChart,          page: 'LeaveDashboard' },
  { name: 'Approvals',               icon: Bell,              page: 'Approvals' },
  { name: 'Payroll',                 icon: CreditCard,        page: 'PayrollManagement' },
  { name: 'Salary Structure',        icon: DollarSign,        page: 'SalaryStructureManagement' },
  { name: 'Loans',                   icon: DollarSign,        page: 'LoanManagement' },
  { name: 'Tax Declarations',        icon: FileText,          page: 'TaxDeclaration' },
  { name: 'Off-Cycle Payments',      icon: DollarSign,        page: 'OffCyclePayments' },
  { name: 'Compliance Reports',      icon: FileText,          page: 'ComplianceReports' },
  { name: 'Payroll Settings',        icon: Settings,          page: 'PayrollSettings' },
  { name: 'Departments',             icon: Building2,         page: 'DepartmentManagement' },
  { name: 'Location Master',         icon: MapPin,            page: 'LocationMaster' },
  { name: 'Asset Tracking',          icon: Laptop,            page: 'AssetTracking' },
  { name: 'Holiday Calendar',        icon: Calendar,          page: 'HolidayCalendar' },
  { name: 'Announcements',           icon: Bell,              page: 'AnnouncementManagement' },
  { name: 'Job Requisitions',        icon: Briefcase,         page: 'JobRequisitions' },
  { name: 'Candidates',              icon: UserPlus,          page: 'Recruitment' },
  { name: 'Interviews',              icon: Calendar,          page: 'InterviewManagement' },
  { name: 'Helpdesk',                icon: HelpCircle,        page: 'Helpdesk' },
  { name: 'Helpdesk Categories',     icon: Settings,          page: 'HelpdeskCategoryManagement' },
  { name: 'Performance',             icon: Target,            page: 'PerformanceManagement' },
  { name: 'PIP Management',          icon: AlertTriangle,     page: 'PIPManagement' },
  { name: 'PMS Settings',            icon: Settings,          page: 'PMSConfiguration' },
  { name: 'User Roles',              icon: UserCog,           page: 'UserRoleManagement' },
  { name: 'Attendance Exemption',    icon: ShieldOff,         page: 'AttendanceExemption' },
  { name: 'Insurance Management',    icon: Shield,            page: 'InsuranceManagement' },
  { name: 'My Insurance',            icon: Shield,            page: 'MyInsurance' },
  { name: 'LOP Configuration',       icon: TrendingDown,      page: 'LOPConfiguration' },
  { name: 'Exit Management',         icon: LogOut,            page: 'ExitManagement' },
  { name: 'Employee Portal',         icon: Users,             page: 'EmployeeEngagementPortal' },
  { name: 'Training Programs',       icon: GraduationCap,     page: 'TrainingManagement' },
  { name: 'Training Needs',          icon: GraduationCap,     page: 'TrainingNeeds' },
  { name: 'My Training',             icon: GraduationCap,     page: 'MyTraining' },
  { name: 'Gate Pass Management',    icon: ShieldCheck,       page: 'GatePassManagement' },
  { name: 'Team Calendar',           icon: Calendar,          page: 'TeamCalendar' },
  { name: 'Import Employees',        icon: UserPlus,          page: 'ImportEmployees' },
  { name: 'Business Cards',          icon: QrCode,            page: 'BusinessCardAdmin' },
  { name: 'Compliance',              icon: Shield,            page: 'ComplianceDashboard' },
  { name: 'Company Policies',        icon: BookOpen,          page: 'CompanyPolicies' },
  { name: 'AskMax AI',               icon: Sparkles,          page: 'AskMax' },
  { name: 'App Settings',            icon: SlidersHorizontal, page: 'AppSettings' },
  { name: 'Admin Panel',             icon: Shield,            page: 'AdminPanel' },
];

const gateAdminMenuItems = [
  { name: 'Gate Admin', icon: ShieldCheck, page: 'GateAdminDashboard' },
  { name: 'My Profile', icon: User2,       page: 'GateAdminProfile' },
];

/* ── Avatar ────────────────────────────────────────────────── */
function Avatar({ name, role }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const gradients = {
    admin: 'from-violet-600 to-indigo-600',
    hr:    'from-indigo-500 to-blue-500',
    management: 'from-emerald-500 to-teal-600',
    gate_admin: 'from-amber-500 to-orange-500',
  };
  const gradient = gradients[role] || 'from-slate-500 to-slate-600';
  return (
    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-white text-sm flex-shrink-0 shadow-sm`}>
      {initial}
    </div>
  );
}

/* ── Sidebar nav item ──────────────────────────────────────── */
function NavItem({ item, isActive, onClick }) {
  const Icon = item.icon;
  return (
    <Link
      to={createPageUrl(item.page)}
      onClick={onClick}
      className={`
        flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
        transition-colors duration-150 select-none
        ${isActive
          ? 'bg-white/15 text-white shadow-sm'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
        }
      `}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 truncate">{item.name}</span>
      {isActive && <ChevronRight className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />}
    </Link>
  );
}

/* ── Layout ─────────────────────────────────────────────────── */
export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const [user,                setUser]               = useState(null);
  const [employeeDisplayName, setEmployeeDisplayName]= useState('');
  const [employeeDepartment,  setEmployeeDepartment] = useState('');
  const [sidebarOpen,         setSidebarOpen]        = useState(false);
  const [pullDistance,        setPullDistance]       = useState(0);
  const [isRefreshing,        setIsRefreshing]       = useState(false);

  const touchStartY = useRef(0);
  const contentRef  = useRef(null);

  const handleTouchStart = useCallback((e) => {
    if (contentRef.current?.scrollTop === 0)
      touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartY.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0 && contentRef.current?.scrollTop === 0)
      setPullDistance(Math.min(delta * 0.4, 64));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance > 50) {
      setIsRefreshing(true);
      setTimeout(() => window.location.reload(), 600);
    } else {
      setPullDistance(0);
    }
    touchStartY.current = 0;
  }, [pullDistance]);

  const [mountedTabs, setMountedTabs] = useState(() =>
    currentPageName && PERSISTENT_TABS.has(currentPageName) ? new Set([currentPageName]) : new Set()
  );
  useEffect(() => {
    if (PERSISTENT_TABS.has(currentPageName))
      setMountedTabs(prev => new Set([...prev, currentPageName]));
  }, [currentPageName]);

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      try {
        const empRecords = await base44.entities.Employee.filter({ user_id: currentUser.id });
        if (empRecords.length > 0) {
          if (empRecords[0].display_name) setEmployeeDisplayName(empRecords[0].display_name);
          if (empRecords[0].department)   setEmployeeDepartment(empRecords[0].department);
        }
        const isDefaultRole = currentUser.role === 'user' && !currentUser.custom_role;
        if (isDefaultRole && empRecords.length === 0) {
          try {
            await base44.functions.invoke('initNewUser', {
              user_id: currentUser.id, email: currentUser.email, full_name: currentUser.full_name
            });
            navigate('/OnboardingForm', { replace: true });
            return;
          } catch (e) { console.error('initNewUser:', e); }
        }
      } catch (_) {}
    } catch (err) {
      console.error('loadUser:', err);
    }
  };

  const handleLogout = async () => { await base44.auth.logout(); };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-8 h-8 border-[3px] border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const userRole = user.custom_role || user.role;

  if (userRole === 'onboarding_pending') {
    if (!window.location.pathname.includes('OnboardingForm'))
      navigate('/OnboardingForm', { replace: true });
    return null;
  }

  const isHR         = userRole === 'hr'         || userRole === 'admin'      || user.role === 'hr'    || user.role === 'admin';
  const isManagement = userRole === 'management'  || user.role === 'management';
  const isGateAdmin  = userRole === 'gate_admin'  || user.role === 'gate_admin';
  const isITDept     = employeeDepartment?.toLowerCase() === 'it';

  let menuItems = employeeMenuItems;
  if (isHR)              menuItems = hrMenuItems;
  else if (isManagement) menuItems = managementMenuItems;
  else if (isGateAdmin)  menuItems = gateAdminMenuItems;
  if (isITDept && !isHR)
    menuItems = [...menuItems, { name: 'Asset Tracking', icon: Laptop, page: 'AssetTracking' }];

  const displayName = employeeDisplayName || user.display_name || user.full_name || user.email;

  const bottomTabs = [
    { label: 'Home',       icon: LayoutDashboard, page: 'Dashboard',      path: '/Dashboard' },
    { label: 'Attendance', icon: Clock,           page: 'MarkAttendance', path: '/MarkAttendance' },
    { label: 'Leave',      icon: FileText,        page: 'Leave',          path: '/Leave' },
    { label: 'Profile',    icon: User2,           page: 'Profile',        path: '/Profile' },
  ];

  return (
    <div className="flex h-dvh bg-background overflow-hidden">

      {/* ── Mobile header ───────────────────────────────────── */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-white/8 flex items-center justify-between px-4"
        style={{
          paddingTop:    'env(safe-area-inset-top)',
          height:        'calc(3.5rem + env(safe-area-inset-top))',
        }}
      >
        <div className="flex items-center gap-2.5">
          {location.pathname !== '/' && location.pathname !== '/Dashboard' && (
            <button
              onClick={() => navigate(-1)}
              style={{ minWidth: 44, minHeight: 44 }}
              className="flex items-center justify-center -ml-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <Link to="/Dashboard" className="flex items-center">
            <div className="bg-white dark:bg-white rounded-xl px-2.5 py-1 shadow-sm">
              <img src="/maxvolt-logo.jpg" alt="MaxVolt Energy" className="h-7 w-auto object-contain" />
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ minWidth: 44, minHeight: 44 }}
            className="flex items-center justify-center -mr-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors"
            aria-label="Toggle menu"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`
          fixed lg:relative inset-y-0 left-0 z-50 flex flex-col flex-shrink-0
          w-64 bg-[#344055] border-r border-[#2a3347]
          transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
          ${sidebarOpen ? 'translate-x-0 shadow-2xl shadow-black/25' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Desktop brand */}
        <div className="hidden lg:flex items-center justify-center px-4 py-5 border-b border-[#2a3347]">
          <div className="bg-white rounded-2xl px-5 py-2.5 shadow-sm">
            <img src="/maxvolt-logo.jpg" alt="MaxVolt Energy" className="h-10 w-auto object-contain" />
          </div>
        </div>

        {/* User card */}
        <div className="px-4 py-3 border-b border-[#2a3347]">
          <div className="flex items-center gap-3 bg-white/8 rounded-xl px-3 py-2.5">
            <Avatar name={displayName} role={userRole} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-white truncate">{displayName}</p>
              <p className="text-[11px] text-white/50 capitalize font-medium mt-0.5">
                {userRole?.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-0.5">
            {menuItems.map((item, idx) => (
              <NavItem
                key={`${item.page}-${idx}`}
                item={item}
                isActive={currentPageName === item.page}
                onClick={() => setSidebarOpen(false)}
              />
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div
          className="px-3 py-3 border-t border-[#2a3347] space-y-1"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
        >
          <div className="px-1 flex justify-end mb-1">
            <NotificationBell />
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            {theme === 'dark'
              ? <><Sun  className="w-4 h-4 flex-shrink-0 text-amber-500" /><span>Light Mode</span></>
              : <><Moon className="w-4 h-4 flex-shrink-0 text-indigo-500" /><span>Dark Mode</span></>
            }
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-300 hover:text-red-200 hover:bg-red-500/15 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ─────────────────────────────────────── */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-background"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile top spacer — exact height of fixed header */}
        <div
          className="lg:hidden flex-shrink-0"
          style={{ height: 'calc(3.5rem + env(safe-area-inset-top))' }}
        />

        {/* Pull-to-refresh */}
        <div
          className="lg:hidden overflow-hidden flex items-center justify-center text-xs text-muted-foreground gap-2 transition-all duration-200"
          style={{ height: isRefreshing ? 40 : pullDistance > 0 ? pullDistance : 0 }}
        >
          <svg
            className={`w-4 h-4 text-indigo-500 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="font-medium">
            {isRefreshing ? 'Refreshing…' : pullDistance > 50 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>

        {/* Page content */}
        {!PERSISTENT_TABS.has(currentPageName) && children}
        {mountedTabs.has('Dashboard')      && <div style={{ display: currentPageName === 'Dashboard'      ? 'block' : 'none' }}><DashboardPage /></div>}
        {mountedTabs.has('MarkAttendance') && <div style={{ display: currentPageName === 'MarkAttendance' ? 'block' : 'none' }}><MarkAttendancePage /></div>}
        {mountedTabs.has('Leave')          && <div style={{ display: currentPageName === 'Leave'          ? 'block' : 'none' }}><LeavePage /></div>}
        {mountedTabs.has('Profile')        && <div style={{ display: currentPageName === 'Profile'        ? 'block' : 'none' }}><ProfilePage /></div>}

        {/* Mobile bottom spacer — keeps content above fixed bottom nav */}
        <div
          className="lg:hidden"
          style={{ height: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        />
      </div>

      {/* ── Mobile bottom tab bar ────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-white/8"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around px-2 pt-1 pb-1.5">
          {bottomTabs.map(item => {
            const Icon    = item.icon;
            const isActive = currentPageName === item.page;
            return (
              <Link
                key={item.page}
                to={item.path}
                onClick={(e) => {
                  setSidebarOpen(false);
                  if (isActive) {
                    e.preventDefault();
                    navigate(item.path, { replace: true });
                    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="flex flex-col items-center gap-0.5 select-none"
                style={{ minWidth: 56, minHeight: 44, paddingTop: 4, paddingBottom: 4 }}
              >
                <div className={`
                  flex items-center justify-center w-10 h-7 rounded-2xl transition-all duration-200
                  ${isActive
                    ? 'bg-gradient-to-br from-indigo-600 to-violet-600 shadow-sm'
                    : 'bg-transparent'
                  }
                `}>
                  <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                </div>
                <span className={`text-[10px] font-semibold leading-none transition-colors ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

    </div>
  );
}
