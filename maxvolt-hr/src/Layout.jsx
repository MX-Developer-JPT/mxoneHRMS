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
  ShieldCheck, Sparkles, AlertTriangle, QrCode, ArrowLeft, User2, ShieldAlert, Award, Landmark, FileSignature, Receipt, ClipboardList, ScanSearch,
  Sun, Moon, BookOpen, SlidersHorizontal, MapPin, Laptop, ChevronRight,
  Home, Zap, Star, HeartHandshake, Timer, Download, MessageSquare, Search, UserCheck,
  Network, Grid3x3, CalendarPlus, GitBranch, Route, Radar,
} from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import DashboardPage from './pages/Dashboard';
import MarkAttendancePage from './pages/MarkAttendance';
import LeavePage from './pages/Leave';
import ProfilePage from './pages/Profile';
import { startTracking as startFieldTripTracking } from '@/lib/fieldTripTracker';
import { initNativePush, clearNativePushToken } from '@/lib/nativePush';
import { startBackgroundGeofence, stopBackgroundGeofence } from '@/lib/geofenceBackground';

const PERSISTENT_TABS = new Set(['Dashboard', 'MarkAttendance', 'Leave', 'Profile']);

/* ── Menu definitions (grouped) ────────────────────────────── */
const employeeMenuGroups = [
  { label: 'Overview', items: [
    { name: 'Dashboard',       icon: LayoutDashboard, page: 'Dashboard' },
  ]},
  { label: 'Attendance', items: [
    { name: 'Mark Attendance', icon: Clock,           page: 'MarkAttendance' },
    { name: 'My Attendance',   icon: Calendar,        page: 'AttendanceHistory' },
    { name: 'Regularisation',  icon: Clock,           page: 'AttendanceRegularisation' },
    { name: 'Field Duty',      icon: Route,           page: 'FieldDuty' },
  ]},
  { label: 'Leave', items: [
    { name: 'Apply Leave',     icon: FileText,        page: 'Leave' },
    { name: 'Comp-Off',        icon: CalendarPlus,    page: 'CompOff' },
  ]},
  { label: 'Payroll', items: [
    { name: 'My Payslips',     icon: CreditCard,      page: 'Payslips' },
    { name: 'My Tax',          icon: Receipt,         page: 'MyTax' },
    { name: 'Tax Declaration', icon: FileText,        page: 'TaxDeclaration' },
  ]},
  { label: 'Documents & Expenses', items: [
    { name: 'My Documents',    icon: FolderOpen,      page: 'Documents' },
    { name: 'Expenses',        icon: DollarSign,      page: 'Reimbursements' },
  ]},
  { label: 'Career & Learning', items: [
    { name: 'My Performance',  icon: Target,          page: 'PerformanceManagement' },
    { name: 'My Training',     icon: GraduationCap,   page: 'MyTraining' },
    { name: 'My Skills',       icon: Zap,             page: 'SkillMatrix' },
    { name: 'My Feedback',     icon: MessageSquare,   page: 'FeedbackSystem' },
  ]},
  { label: 'Benefits', items: [
    { name: 'My Insurance',    icon: Shield,          page: 'MyInsurance' },
    { name: 'My Assets',       icon: Laptop,          page: 'MyAssets' },
  ]},
  { label: 'Engagement', items: [
    { name: 'Announcements',   icon: Bell,            page: 'Announcements' },
    { name: 'Helpdesk',        icon: HelpCircle,      page: 'Helpdesk' },
    { name: 'Recognition',     icon: Award,           page: 'Recognition' },
    { name: 'Pulse Surveys',   icon: ClipboardList,   page: 'PulseSurveys' },
    { name: 'Employee Portal', icon: Users,           page: 'EmployeeEngagementPortal' },
    { name: 'Org Chart',       icon: Network,         page: 'OrgChart' },
  ]},
  { label: 'AI', items: [
    { name: 'AskMax AI',       icon: Sparkles,        page: 'AskMax' },
  ]},
  { label: 'Account', items: [
    { name: 'Gate Pass',       icon: ShieldCheck,     page: 'GatePassRequest' },
    { name: 'My Exit',         icon: LogOut,          page: 'MyExit' },
    { name: 'My Profile',      icon: User2,           page: 'Profile' },
    { name: 'App Settings',    icon: SlidersHorizontal, page: 'AppSettings' },
  ]},
];

const managementMenuGroups = [
  { label: 'Overview', items: [
    { name: 'Dashboard',                icon: LayoutDashboard, page: 'Dashboard' },
    { name: 'MIS Analytics',            icon: PieChart,        page: 'MISDashboard' },
  ]},
  { label: 'My Team', items: [
    { name: 'My Team',                  icon: Users,           page: 'Employees' },
    { name: 'Team Attendance',          icon: BarChart3,       page: 'AllAttendance' },
    { name: 'Leave Approvals',          icon: FileText,        page: 'LeaveManagement' },
    { name: 'Leave Dashboard',          icon: PieChart,        page: 'LeaveDashboard' },
    { name: 'Regularisation Approvals', icon: Clock,           page: 'RegularisationApproval' },
    { name: 'Expense Approvals',        icon: DollarSign,      page: 'Approvals' },
    { name: 'Gate Pass Approvals',      icon: ShieldCheck,     page: 'GatePassApproval' },
    { name: 'Comp-Off Approvals',       icon: CalendarPlus,    page: 'CompOff' },
    { name: 'Confirmation',             icon: UserCheck,       page: 'ConfirmationManagement' },
    { name: 'Team Calendar',            icon: Calendar,        page: 'TeamCalendar' },
    { name: 'Org Chart',                icon: Network,         page: 'OrgChart' },
    { name: 'Talent Grid (9-Box)',      icon: Grid3x3,         page: 'TalentGrid' },
  ]},
  { label: 'AI Insights', items: [
    { name: 'Attrition Risk (AI)',      icon: ShieldAlert,     page: 'AttritionRisk' },
    { name: 'AskMax AI',                icon: Sparkles,        page: 'AskMax' },
    { name: 'Recruitment Analytics',    icon: BarChart3,       page: 'RecruitmentAnalytics' },
  ]},
  { label: 'Recruitment', items: [
    { name: 'Job Requisitions',         icon: Briefcase,       page: 'JobRequisitions' },
    { name: 'Candidates',               icon: UserPlus,        page: 'Recruitment' },
    { name: 'Interviews',               icon: Calendar,        page: 'InterviewManagement' },
    { name: 'Offer Letters',            icon: FileSignature,   page: 'OfferLetters' },
  ]},
  { label: 'My Attendance', items: [
    { name: 'Mark Attendance',          icon: Clock,           page: 'MarkAttendance' },
    { name: 'My Attendance',            icon: Calendar,        page: 'AttendanceHistory' },
    { name: 'Regularisation',           icon: Clock,           page: 'AttendanceRegularisation' },
    { name: 'Field Duty',               icon: Route,           page: 'FieldDuty' },
  ]},
  { label: 'My Work', items: [
    { name: 'Apply Leave',              icon: FileText,        page: 'Leave' },
    { name: 'My Payslips',              icon: CreditCard,      page: 'Payslips' },
    { name: 'My Documents',             icon: FolderOpen,      page: 'Documents' },
    { name: 'Expenses',                 icon: DollarSign,      page: 'Reimbursements' },
    { name: 'My Performance',           icon: Target,          page: 'PerformanceManagement' },
    { name: 'My Training',              icon: GraduationCap,   page: 'MyTraining' },
    { name: 'My Insurance',             icon: Shield,          page: 'MyInsurance' },
    { name: 'My Assets',                icon: Laptop,          page: 'MyAssets' },
    { name: 'My Exit',                  icon: LogOut,          page: 'MyExit' },
  ]},
  { label: 'Engagement', items: [
    { name: 'Announcements',            icon: Bell,            page: 'Announcements' },
    { name: 'Helpdesk',                 icon: HelpCircle,      page: 'Helpdesk' },
    { name: 'Recognition',              icon: Award,           page: 'Recognition' },
    { name: 'Pulse Surveys',            icon: ClipboardList,   page: 'PulseSurveys' },
    { name: 'Employee Portal',          icon: Users,           page: 'EmployeeEngagementPortal' },
  ]},
  { label: 'Account', items: [
    { name: 'My Profile',               icon: User2,           page: 'Profile' },
    { name: 'App Settings',             icon: SlidersHorizontal, page: 'AppSettings' },
  ]},
];

const hrMenuGroups = [
  { label: 'Overview', items: [
    { name: 'Dashboard',               icon: LayoutDashboard, page: 'Dashboard' },
    { name: 'MIS Analytics',           icon: PieChart,        page: 'MISDashboard' },
  ]},
  { label: 'AI & Intelligence', items: [
    { name: 'Attrition Risk (AI)',     icon: ShieldAlert,     page: 'AttritionRisk' },
    { name: 'Anomaly Detection (AI)',  icon: ScanSearch,      page: 'AnomalyDetection' },
    { name: 'AskMax AI',              icon: Sparkles,         page: 'AskMax' },
    { name: 'Attendance Insights',    icon: Sparkles,         page: 'AttendanceNarrative' },
    { name: 'HR Digest',              icon: BookOpen,         page: 'HRDigest' },
  ]},
  { label: 'Employees', items: [
    { name: 'Employees',               icon: Users,           page: 'Employees' },
    { name: 'Org Chart',               icon: Network,         page: 'OrgChart' },
    { name: 'Onboarding Approval',     icon: UserPlus,        page: 'OnboardingApproval' },
    { name: 'Employee Documents',      icon: FolderOpen,      page: 'EmployeeDocuments' },
    { name: 'Letter Generator (AI)',   icon: FileSignature,   page: 'LetterGenerator' },
  ]},
  { label: 'Attendance', items: [
    { name: 'All Attendance',          icon: Clock,           page: 'AllAttendance' },
    { name: 'Regularisation Approvals',icon: Clock,           page: 'RegularisationApproval' },
    { name: 'Attendance Reports',      icon: BarChart3,       page: 'AttendanceReports' },
    { name: 'WFH Tracking',           icon: Home,             page: 'WFHTracking' },
    { name: 'Overtime Management',    icon: Timer,            page: 'OvertimeManagement' },
    { name: 'Biometric Logs',          icon: Clock,           page: 'AttendanceLogDashboard' },
    { name: 'Field Duty Tracking',     icon: Route,           page: 'FieldDuty' },
    { name: 'Shift Management',        icon: UserCog,         page: 'ShiftManagement' },
    { name: 'Attendance Exemption',    icon: ShieldOff,       page: 'AttendanceExemption' },
    { name: 'Geofence Eligibility',    icon: Radar,           page: 'GeofenceEligibility' },
  ]},
  { label: 'Leave', items: [
    { name: 'Leave Management',        icon: FileText,        page: 'LeaveManagement' },
    { name: 'Leave Dashboard',         icon: PieChart,        page: 'LeaveDashboard' },
    { name: 'Comp-Off',                icon: CalendarPlus,    page: 'CompOff' },
    { name: 'Approvals',               icon: Bell,            page: 'Approvals' },
  ]},
  { label: 'Payroll', items: [
    { name: 'Payroll',                 icon: CreditCard,      page: 'PayrollManagement' },
    { name: 'Salary Structure',        icon: DollarSign,      page: 'SalaryStructureManagement' },
    { name: 'Loans',                   icon: DollarSign,      page: 'LoanManagement' },
    { name: 'Off-Cycle Payments',      icon: DollarSign,      page: 'OffCyclePayments' },
    { name: 'Tally Export',           icon: Download,         page: 'TallyExport' },
    { name: 'LOP Configuration',       icon: TrendingDown,    page: 'LOPConfiguration' },
  ]},
  { label: 'Tax & Statutory', items: [
    { name: 'Tax Declarations',        icon: FileText,        page: 'TaxDeclaration' },
    { name: 'Form 16 & TDS',           icon: Receipt,         page: 'Form16' },
    { name: 'PF & ESI Registers',      icon: ShieldCheck,     page: 'StatutoryRegisters' },
    { name: 'Gratuity Report',         icon: Landmark,        page: 'GratuityReport' },
    { name: 'Compliance Reports',      icon: FileText,        page: 'ComplianceReports' },
    { name: 'Min Wages Check',        icon: AlertTriangle,    page: 'MinimumWages' },
    { name: 'Payroll Settings',        icon: Settings,        page: 'PayrollSettings' },
  ]},
  { label: 'Recruitment', items: [
    { name: 'Job Requisitions',        icon: Briefcase,       page: 'JobRequisitions' },
    { name: 'Candidates',              icon: UserPlus,        page: 'Recruitment' },
    { name: 'Interviews',              icon: Calendar,        page: 'InterviewManagement' },
    { name: 'Offer Letters',           icon: FileSignature,   page: 'OfferLetters' },
    { name: 'Recruitment Analytics',   icon: BarChart3,       page: 'RecruitmentAnalytics' },
  ]},
  { label: 'Performance', items: [
    { name: 'Performance',             icon: Target,          page: 'PerformanceManagement' },
    { name: 'Talent Grid (9-Box)',     icon: Grid3x3,         page: 'TalentGrid' },
    { name: 'PIP Management',          icon: AlertTriangle,   page: 'PIPManagement' },
    { name: 'Confirmation',            icon: UserCheck,       page: 'ConfirmationManagement' },
    { name: '360° Feedback',           icon: MessageSquare,   page: 'FeedbackSystem' },
    { name: 'Skill Matrix',            icon: Zap,             page: 'SkillMatrix' },
    { name: 'PMS Settings',            icon: Settings,        page: 'PMSConfiguration' },
  ]},
  { label: 'Learning & Development', items: [
    { name: 'Training Programs',       icon: GraduationCap,   page: 'TrainingManagement' },
    { name: 'Training Needs',          icon: GraduationCap,   page: 'TrainingNeeds' },
    { name: 'My Training',             icon: GraduationCap,   page: 'MyTraining' },
  ]},
  { label: 'Engagement', items: [
    { name: 'Announcements',           icon: Bell,            page: 'AnnouncementManagement' },
    { name: 'Helpdesk',                icon: HelpCircle,      page: 'Helpdesk' },
    { name: 'Helpdesk Categories',     icon: Settings,        page: 'HelpdeskCategoryManagement' },
    { name: 'Recognition',             icon: Award,           page: 'Recognition' },
    { name: 'Pulse Surveys & eNPS',    icon: ClipboardList,   page: 'PulseSurveys' },
    { name: 'Employee Portal',         icon: Users,           page: 'EmployeeEngagementPortal' },
  ]},
  { label: 'Benefits & Exit', items: [
    { name: 'Insurance Management',    icon: Shield,          page: 'InsuranceManagement' },
    { name: 'My Insurance',            icon: Shield,          page: 'MyInsurance' },
    { name: 'Exit Management',         icon: LogOut,          page: 'ExitManagement' },
  ]},
  { label: 'Operations', items: [
    { name: 'Departments',             icon: Building2,       page: 'DepartmentManagement' },
    { name: 'Asset Tracking',          icon: Laptop,          page: 'AssetTracking' },
    { name: 'Holiday Calendar',        icon: Calendar,        page: 'HolidayCalendar' },
    { name: 'Gate Pass Management',    icon: ShieldCheck,     page: 'GatePassManagement' },
    { name: 'Team Calendar',           icon: Calendar,        page: 'TeamCalendar' },
  ]},
  { label: 'Analytics & Planning', items: [
    { name: 'D&I Metrics',             icon: HeartHandshake,  page: 'DIMetrics' },
    { name: 'Workforce Planning',      icon: Users,           page: 'WorkforcePlanning' },
  ]},
  { label: 'Compliance', items: [
    { name: 'Compliance',              icon: Shield,          page: 'ComplianceDashboard' },
    { name: 'POSH Compliance',         icon: ShieldCheck,     page: 'POSHCompliance' },
  ]},
  { label: 'HR Settings', items: [
    { name: 'App Settings',            icon: SlidersHorizontal, page: 'AppSettings' },
  ]},
];

const gateAdminMenuGroups = [
  { label: '', items: [
    { name: 'Gate Admin', icon: ShieldCheck, page: 'GateAdminDashboard' },
    { name: 'My Profile', icon: User2,       page: 'GateAdminProfile' },
  ]},
];

/* ── Avatar ────────────────────────────────────────────────── */
function Avatar({ name, role, size = 'md' }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const colors = {
    admin:      'bg-[#AF52DE]',   // Apple purple
    hr:         'bg-[#007AFF]',   // Apple blue
    management: 'bg-[#34C759]',   // Apple green
    manager:    'bg-[#34C759]',
    gate_admin: 'bg-[#FF9500]',   // Apple orange
  };
  const bg   = colors[role] || 'bg-[#8E8E93]';
  const dims  = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm';
  return (
    <div className={`${dims} rounded-xl ${bg} flex items-center justify-center font-semibold text-white flex-shrink-0`}>
      {initial}
    </div>
  );
}

/* ── Section label ─────────────────────────────────────────── */
function NavSectionLabel({ label }) {
  if (!label) return null;
  return (
    <p className="px-3 pt-4 pb-0.5 text-[10px] font-semibold tracking-widest uppercase text-[#8E8E93] dark:text-[#636366] select-none">
      {label}
    </p>
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
        flex items-center gap-2.5 px-3 py-[9px] rounded-xl text-[13.5px] font-medium
        transition-all duration-150 select-none group
        ${isActive
          ? 'bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]'
          : 'text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-white/6 hover:text-[#1D1D1F] dark:hover:text-white'
        }
      `}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-[#007AFF] dark:text-[#0A84FF]' : 'text-[#8E8E93] group-hover:text-[#1D1D1F] dark:group-hover:text-white'}`} />
      <span className="flex-1 truncate">{item.name}</span>
      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF] dark:bg-[#0A84FF] flex-shrink-0" />}
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
  const [moreSheetOpen,       setMoreSheetOpen]      = useState(false);
  const [pullDistance,        setPullDistance]       = useState(0);
  const [isRefreshing,        setIsRefreshing]       = useState(false);
  const [menuSearch,          setMenuSearch]         = useState('');
  const [sheetSearch,         setSheetSearch]        = useState('');

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
      setPullDistance(Math.min(delta * 0.4, 60));
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance > 48) {
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

      // Resume GPS tracking for an already-active Field Duty trip (e.g. one auto-started
      // from a Gate Pass request, or one left running from before a page reload) — the
      // tracker itself lives outside any single page, so this is what makes it survive
      // a full reload/relogin rather than only surviving in-app navigation.
      (async () => {
        try {
          const res = await base44.functions.invoke('getFieldTrips', { scope: 'mine' });
          const d = res.data || res;
          const active = d?.success && (d.trips || []).find(t => t.status === 'active');
          if (active) startFieldTripTracking(active.id, active.distance_km || 0);
        } catch { /* Field Duty not applicable for this role, or offline — non-fatal */ }
      })();

      // No-ops in a plain browser tab; inside the Capacitor shell, registers this
      // device for real native push (FCM on Android, APNs on iOS).
      initNativePush().catch((e) => console.warn('initNativePush:', e.message));

      // Start Background Geofence automatically for eligible employees — HR
      // decides eligibility (Employee.geofence_eligible), employees get no
      // on/off control. No-ops internally (via getMyGeofence's
      // geofence_eligible flag) for anyone HR hasn't marked eligible.
      startBackgroundGeofence().catch((e) => console.warn('startBackgroundGeofence:', e.message));
    } catch (err) {
      console.error('loadUser:', err);
    }
  };

  useEffect(() => {
    const onPushTap = (e) => { if (e.detail?.link) navigate(e.detail.link); };
    window.addEventListener('push-notification-tap', onPushTap);
    return () => window.removeEventListener('push-notification-tap', onPushTap);
  }, [navigate]);

  const handleLogout = async () => {
    await clearNativePushToken().catch(() => {});
    await stopBackgroundGeofence().catch(() => {});
    await base44.auth.logout();
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="w-8 h-8 border-[3px] border-[#007AFF]/20 border-t-[#007AFF] rounded-full animate-spin" />
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
  const isManagement = userRole === 'management'  || userRole === 'manager'    || user.role === 'management' || user.role === 'manager';
  const isGateAdmin  = userRole === 'gate_admin'  || user.role === 'gate_admin';
  const isITDept     = employeeDepartment?.toLowerCase() === 'it';

  const isAdmin = user.role === 'admin';

  let menuGroups = employeeMenuGroups;
  if (isHR)              menuGroups = hrMenuGroups;
  else if (isManagement) menuGroups = managementMenuGroups;
  else if (isGateAdmin)  menuGroups = gateAdminMenuGroups;
  if (isITDept && !isHR) {
    menuGroups = [...menuGroups, { label: 'IT', items: [{ name: 'Asset Tracking', icon: Laptop, page: 'AssetTracking' }] }];
  }
  if (isAdmin) {
    menuGroups = [...menuGroups, { label: 'Administration', items: [
      { name: 'User Roles',        icon: UserCog,           page: 'UserRoleManagement' },
      { name: 'Workflow Builder',  icon: GitBranch,         page: 'WorkflowBuilder' },
      { name: 'Admin Panel',       icon: Shield,            page: 'AdminPanel' },
      { name: 'Import Employees',  icon: UserPlus,          page: 'ImportEmployees' },
      { name: 'Company Policies',  icon: BookOpen,          page: 'CompanyPolicies' },
      { name: 'Business Cards',    icon: QrCode,            page: 'BusinessCardAdmin' },
      { name: 'Location Master',   icon: MapPin,            page: 'LocationMaster' },
    ]}];
  }
  const menuItems = menuGroups.flatMap(g => g.items);

  // Filter menu groups based on search
  const filteredMenuGroups = (query) => {
    if (!query.trim()) return menuGroups;
    const q = query.toLowerCase();
    return menuGroups
      .map(g => ({ ...g, items: g.items.filter(i => i.name.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0);
  };

  const displayName = employeeDisplayName || user.display_name || user.full_name || user.email;

  // Role-aware primary bottom tabs (max 4, plus "More")
  const primaryTabs = isHR
    ? [
        { label: 'Home',      icon: LayoutDashboard, page: 'Dashboard',    path: '/Dashboard' },
        { label: 'Employees', icon: Users,            page: 'Employees',    path: '/Employees' },
        { label: 'Attendance',icon: Clock,            page: 'AllAttendance',path: '/AllAttendance' },
        { label: 'Leaves',    icon: FileText,         page: 'LeaveManagement', path: '/LeaveManagement' },
      ]
    : isManagement
    ? [
        { label: 'Home',      icon: LayoutDashboard, page: 'Dashboard',    path: '/Dashboard' },
        { label: 'My Team',   icon: Users,            page: 'Employees',    path: '/Employees' },
        { label: 'Attendance',icon: Clock,            page: 'MarkAttendance',path: '/MarkAttendance' },
        { label: 'Leave',     icon: FileText,         page: 'Leave',        path: '/Leave' },
      ]
    : [
        { label: 'Home',      icon: LayoutDashboard, page: 'Dashboard',    path: '/Dashboard' },
        { label: 'Attendance',icon: Clock,            page: 'MarkAttendance',path: '/MarkAttendance' },
        { label: 'Leave',     icon: FileText,         page: 'Leave',        path: '/Leave' },
        { label: 'Profile',   icon: User2,            page: 'Profile',      path: '/Profile' },
      ];

  const currentTabActive = primaryTabs.some(t => t.page === currentPageName);

  return (
    <div className="flex h-dvh bg-background overflow-hidden">

      {/* ── Mobile header — iOS Navigation Bar ──────────────── */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          height: 'calc(3rem + env(safe-area-inset-top))',
          background: 'rgba(242,242,247,0.85)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: '0.5px solid rgba(0,0,0,0.12)',
        }}
      >
        {/* Left: Back button or Logo */}
        <div className="flex items-center gap-1 w-24">
          {location.pathname !== '/' && location.pathname !== '/Dashboard' ? (
            <button
              onClick={() => navigate(-1)}
              style={{ minWidth: 44, minHeight: 44 }}
              className="flex items-center gap-0.5 -ml-2 text-[#007AFF] dark:text-[#0A84FF] font-medium text-[17px]"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={2.5} />
            </button>
          ) : (
            <Link to="/Dashboard">
              <img src="/favicon.svg?v=2" alt="MaxVolt" className="h-6 w-auto object-contain rounded-lg" />
            </Link>
          )}
        </div>

        {/* Center: Page title */}
        <span className="font-semibold text-[17px] text-[#1D1D1F] dark:text-white tracking-[-0.02em] truncate max-w-[40vw] text-center">
          {currentPageName?.replace(/([A-Z])/g, ' $1').trim() || 'Home'}
        </span>

        {/* Right: Notifications */}
        <div className="flex items-center justify-end gap-1 w-24">
          <NotificationBell />
        </div>
      </div>

      {/* ── Desktop Sidebar — Apple macOS style ─────────────── */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 w-60 bg-white dark:bg-[#111113] border-r border-[#E0E0E5] dark:border-[#38383A]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E0E0E5] dark:border-[#38383A]">
          <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-white shadow-apple-sm">
            <img src="/favicon.svg?v=2" alt="MaxVolt" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[13px] text-[#1D1D1F] dark:text-white truncate leading-none">Maxvolt One</p>
            <p className="text-[11px] text-[#6E6E73] dark:text-[#8E8E93] mt-0.5">Human Resources</p>
          </div>
        </div>

        {/* User card */}
        <div className="px-3 py-3 border-b border-[#E0E0E5] dark:border-[#38383A]">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-[#F2F2F7] dark:bg-white/6">
            <Avatar name={displayName} role={userRole} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[13px] text-[#1D1D1F] dark:text-white truncate leading-tight">{displayName}</p>
              <p className="text-[11px] text-[#6E6E73] dark:text-[#8E8E93] capitalize mt-0.5 leading-none">
                {userRole?.replace(/_/g, ' ')}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-[#E0E0E5] dark:border-[#38383A]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8E8E93]" />
            <input
              type="text"
              value={menuSearch}
              onChange={e => setMenuSearch(e.target.value)}
              placeholder="Search menu…"
              className="w-full pl-7 pr-3 py-1.5 text-[12.5px] rounded-lg bg-[#F2F2F7] dark:bg-white/6 border-none outline-none text-[#1D1D1F] dark:text-white placeholder-[#8E8E93] focus:ring-1 focus:ring-[#007AFF]/30"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {filteredMenuGroups(menuSearch).map((group, gi) => (
            <div key={gi}>
              <NavSectionLabel label={group.label} />
              <div className="space-y-0.5">
                {group.items.map((item, idx) => (
                  <NavItem
                    key={`${item.page}-${idx}`}
                    item={item}
                    isActive={currentPageName === item.page}
                    onClick={() => { if (menuSearch) setMenuSearch(''); }}
                  />
                ))}
              </div>
            </div>
          ))}
          {menuSearch && filteredMenuGroups(menuSearch).length === 0 && (
            <p className="px-3 py-4 text-xs text-[#8E8E93] text-center">No results for "{menuSearch}"</p>
          )}
        </nav>

        {/* Footer */}
        <div
          className="px-2 py-2 border-t border-[#E0E0E5] dark:border-[#38383A] space-y-0.5"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          <div className="px-1 flex justify-end mb-1">
            <NotificationBell placement="sidebar" />
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center gap-2.5 px-3 py-[9px] rounded-xl text-[13.5px] font-medium text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-white/6 hover:text-[#1D1D1F] dark:hover:text-white transition-colors"
          >
            {theme === 'dark'
              ? <><Sun  className="w-4 h-4 flex-shrink-0 text-[#FF9500]" /><span>Light Mode</span></>
              : <><Moon className="w-4 h-4 flex-shrink-0 text-[#007AFF]" /><span>Dark Mode</span></>
            }
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-[9px] rounded-xl text-[13.5px] font-medium text-[#FF3B30] hover:bg-[#FF3B30]/8 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Sign out</span>
          </button>
          <div className="px-3 pt-1 flex items-center gap-2 text-[10.5px] text-[#8E8E93]">
            <a href="/PrivacyPolicy" target="_blank" rel="noreferrer" className="hover:underline">Privacy</a>
            <span>·</span>
            <a href="/TermsOfService" target="_blank" rel="noreferrer" className="hover:underline">Terms</a>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-background overscroll-y-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile top spacer */}
        <div className="lg:hidden flex-shrink-0" style={{ height: 'calc(3rem + env(safe-area-inset-top))' }} />

        {/* Pull-to-refresh indicator */}
        <div
          className="lg:hidden overflow-hidden flex items-center justify-center gap-2 transition-all duration-200"
          style={{ height: isRefreshing ? 36 : pullDistance > 0 ? pullDistance : 0 }}
        >
          <svg className={`w-4 h-4 text-[#007AFF] ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-xs font-medium text-[#6E6E73]">
            {isRefreshing ? 'Refreshing…' : pullDistance > 48 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>

        {/* Page content */}
        {!PERSISTENT_TABS.has(currentPageName) && children}
        {mountedTabs.has('Dashboard')      && <div style={{ display: currentPageName === 'Dashboard'      ? 'block' : 'none' }}><DashboardPage /></div>}
        {mountedTabs.has('MarkAttendance') && <div style={{ display: currentPageName === 'MarkAttendance' ? 'block' : 'none' }}><MarkAttendancePage /></div>}
        {mountedTabs.has('Leave')          && <div style={{ display: currentPageName === 'Leave'          ? 'block' : 'none' }}><LeavePage /></div>}
        {mountedTabs.has('Profile')        && <div style={{ display: currentPageName === 'Profile'        ? 'block' : 'none' }}><ProfilePage /></div>}

        {/* Mobile bottom spacer — must exceed the fixed tab bar's height (tab
            minHeight 44px + nav padding) plus the safe-area inset, with margin,
            so the last item on any page scrolls clear of the bar and stays
            tappable. Was 4.5rem, which left the final card partly under the bar
            on taller safe-area devices. */}
        <div className="lg:hidden" style={{ height: 'calc(6rem + env(safe-area-inset-bottom))' }} />
      </div>

      {/* ── "More" bottom sheet (iOS style) ─────────────────── */}
      {moreSheetOpen && (
        <>
          {/* Scrim */}
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black/40"
            style={{ backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
            onClick={() => { setMoreSheetOpen(false); setSheetSearch(''); }}
          />
          {/* Sheet — flex column so the footer (sign out + policy links) is always
              pinned and visible; the menu list takes the remaining space and
              scrolls. Avoids the earlier bug where fixed header/footer heights
              plus a calc()-sized list overflowed 78dvh and pushed Sign out
              off-screen on smaller phones. */}
          <div
            className="lg:hidden fixed left-0 right-0 z-50 rounded-t-[28px] overflow-hidden animate-slide-up flex flex-col"
            style={{
              // bottom:0 alone leaves a gap on iOS Safari (see main.jsx
              // trackVisualViewportInset comment) — offset by the tracked
              // visual-viewport inset so the sheet sits flush to the true
              // bottom of the screen.
              bottom: 'var(--vv-bottom-inset, 0px)',
              background: 'rgba(242,242,247,0.96)',
              backdropFilter: 'saturate(180%) blur(40px)',
              WebkitBackdropFilter: 'saturate(180%) blur(40px)',
              maxHeight: '85dvh',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {/* Drag handle */}
            <div className="flex-shrink-0 flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full bg-[#8E8E93]/35" />
            </div>

            {/* Sheet header */}
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-[#E0E0E5]/80">
              <div className="flex items-center gap-2.5">
                <Avatar name={displayName} role={userRole} size="sm" />
                <div>
                  <p className="font-semibold text-[14px] text-[#1D1D1F] leading-tight">{displayName}</p>
                  <p className="text-[11px] text-[#6E6E73] capitalize">{userRole?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="w-9 h-9 rounded-full bg-[#E5E5EA] flex items-center justify-center"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark'
                    ? <Sun className="w-4 h-4 text-[#FF9500]" />
                    : <Moon className="w-4 h-4 text-[#007AFF]" />
                  }
                </button>
                <button
                  onClick={() => { setMoreSheetOpen(false); setSheetSearch(''); }}
                  className="w-9 h-9 rounded-full bg-[#E5E5EA] flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-[#6E6E73]" />
                </button>
              </div>
            </div>

            {/* Sheet search */}
            <div className="flex-shrink-0 px-4 py-2 border-b border-[#E0E0E5]/80">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93]" />
                <input
                  type="text"
                  value={sheetSearch}
                  onChange={e => setSheetSearch(e.target.value)}
                  placeholder="Search menu…"
                  className="w-full pl-9 pr-3 py-2 text-[14px] rounded-xl bg-[#E5E5EA]/60 border-none outline-none text-[#1D1D1F] placeholder-[#8E8E93] focus:ring-1 focus:ring-[#007AFF]/30"
                />
              </div>
            </div>

            {/* Menu list — flex-1 + min-h-0 lets it shrink and scroll within the sheet */}
            <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
              {filteredMenuGroups(sheetSearch).map((group, gi) => (
                <div key={gi}>
                  {group.label ? (
                    <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-widest uppercase text-[#8E8E93] select-none">
                      {group.label}
                    </p>
                  ) : null}
                  <div className="space-y-0.5">
                    {group.items.map((item, idx) => {
                      const Icon = item.icon;
                      const isActive = currentPageName === item.page;
                      return (
                        <Link
                          key={`sheet-${item.page}-${idx}`}
                          to={createPageUrl(item.page)}
                          onClick={() => { setMoreSheetOpen(false); setSheetSearch(''); }}
                          className={`
                            flex items-center gap-3 px-3.5 py-3 rounded-xl text-[15px] font-medium select-none
                            transition-colors duration-150
                            ${isActive
                              ? 'bg-[#007AFF]/10 text-[#007AFF]'
                              : 'text-[#1D1D1F] hover:bg-[#E5E5EA]/60'
                            }
                          `}
                          style={{ minHeight: 48 }}
                        >
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-[#007AFF]' : 'bg-[#E5E5EA]'}`}>
                            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-[#6E6E73]'}`} />
                          </div>
                          <span className="flex-1">{item.name}</span>
                          {isActive && <div className="w-2 h-2 rounded-full bg-[#007AFF]" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
              {sheetSearch && filteredMenuGroups(sheetSearch).length === 0 && (
                <p className="py-6 text-sm text-[#8E8E93] text-center">No results for "{sheetSearch}"</p>
              )}
            </nav>

            {/* Sheet footer — flex-shrink-0 keeps Sign out + policy links pinned */}
            <div className="flex-shrink-0 px-3 py-2 border-t border-[#E0E0E5]/80">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-[15px] font-medium text-[#FF3B30] hover:bg-[#FF3B30]/8 transition-colors"
                style={{ minHeight: 48 }}
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-[#FF3B30]/10 flex-shrink-0">
                  <LogOut className="w-4 h-4 text-[#FF3B30]" />
                </div>
                Sign out
              </button>
              <div className="flex items-center justify-center gap-2 pt-2 text-[11px] text-[#8E8E93]">
                <a href="/PrivacyPolicy" target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
                <span>·</span>
                <a href="/TermsOfService" target="_blank" rel="noreferrer" className="hover:underline">Terms of Service</a>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Mobile bottom tab bar — iOS style ───────────────── */}
      {/* Solid, theme-aware background that fills through the safe-area inset so
          the whole bar reads as one unit flush to the bottom of the screen — the
          previous translucent grey blended into the page background and looked
          like the bar was floating with an empty gap beneath it.
          bottom: var(--vv-bottom-inset) (set in main.jsx) instead of plain
          bottom:0 — iOS Safari resolves position:fixed;bottom:0 against its
          LAYOUT viewport (which reserves space for the browser's own bottom
          toolbar, even when not shown / even in standalone PWA mode), leaving
          a gap the height of that reserved space. Tracking window.visualViewport
          gives the actual visible bottom edge. */}
      <nav
        className="lg:hidden fixed left-0 right-0 z-40 bg-white dark:bg-[#1C1C1E] border-t border-black/10 dark:border-white/10"
        style={{
          bottom: 'var(--vv-bottom-inset, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex items-center pt-1 pb-1">
          {/* Primary tabs */}
          {primaryTabs.map(item => {
            const Icon     = item.icon;
            const isActive = currentPageName === item.page;
            return (
              <Link
                key={item.page}
                to={item.path}
                onClick={(e) => {
                  if (isActive) {
                    e.preventDefault();
                    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="flex-1 flex flex-col items-center gap-0.5 py-1 select-none"
                style={{ minHeight: 44 }}
              >
                <Icon
                  className="w-6 h-6 transition-colors duration-150"
                  style={{ color: isActive ? '#007AFF' : '#8E8E93' }}
                  strokeWidth={isActive ? 2 : 1.75}
                />
                <span
                  className="text-[10px] font-medium leading-none transition-colors duration-150"
                  style={{ color: isActive ? '#007AFF' : '#8E8E93' }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}

          {/* More tab */}
          <button
            onClick={() => setMoreSheetOpen(true)}
            className="flex-1 flex flex-col items-center gap-0.5 py-1 select-none"
            style={{ minHeight: 44 }}
            aria-label="More"
          >
            <Menu
              className="w-6 h-6 transition-colors duration-150"
              style={{ color: moreSheetOpen || (!currentTabActive && currentPageName !== 'Dashboard') ? '#007AFF' : '#8E8E93' }}
              strokeWidth={1.75}
            />
            <span
              className="text-[10px] font-medium leading-none"
              style={{ color: moreSheetOpen || (!currentTabActive && currentPageName !== 'Dashboard') ? '#007AFF' : '#8E8E93' }}
            >
              More
            </span>
          </button>
        </div>
      </nav>

    </div>
  );
}
