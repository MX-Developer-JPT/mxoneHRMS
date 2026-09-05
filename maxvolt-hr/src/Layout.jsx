import React, { useState, useEffect, useRef, useCallback, lazy } from 'react';
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
  Network, Grid3x3, CalendarPlus, GitBranch, Route, Radar, Camera, Loader2, LayoutGrid, Archive,
  UploadCloud,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import NotificationBell from '@/components/NotificationBell';
import ErrorBoundary from '@/components/ErrorBoundary';
// Lazy, not static — these previously loaded their full component tree (and,
// for Dashboard, every role-specific dashboard variant plus its data-fetch
// burst) into the main bundle for every user on every page, regardless of
// which page they actually landed on first. Still kept mounted-but-hidden
// once visited (see mountedTabs below) so switching back is instant; only
// the FIRST visit now pays a lazy-chunk fetch instead of it being paid
// upfront by the whole app.
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const MarkAttendancePage = lazy(() => import('./pages/MarkAttendance'));
const LeavePage = lazy(() => import('./pages/Leave'));
const ProfilePage = lazy(() => import('./pages/Profile'));
import { startTracking as startFieldTripTracking } from '@/lib/fieldTripTracker';
import { initNativePush, clearNativePushToken } from '@/lib/nativePush';
import { startBackgroundGeofence, stopBackgroundGeofence, checkGeofenceEligibility, requestBatteryOptimizationExemption, requestBackgroundLocationIfNeeded } from '@/lib/geofenceBackground';
import { syncStatusBarTheme, initKeyboardAvoidance } from '@/lib/nativeChrome';
import { startHeartbeat, logPageView } from '@/lib/adoptionTracking';

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
    { name: 'Holiday Calendar', icon: Calendar,       page: 'HolidayCalendar' },
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
    { name: 'My Visitors',     icon: Users,           page: 'MyVisitors' },
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
    { name: 'Skill Grid',               icon: LayoutGrid,      page: 'SkillGrid' },
    { name: 'Visitor Management',       icon: Users,           page: 'VisitorManagement' },
  ]},
  // "My Team"/"Team Attendance" above are scoped to the management viewer's
  // own downstream hierarchy (direct + indirect reports) — these two are the
  // same pages with ?scope=org, giving an explicit, separately-labeled
  // org-wide view alongside the team-scoped default.
  { label: 'Organisation', items: [
    { name: 'All Employees',            icon: Users,           page: 'Employees?scope=org' },
    { name: 'All Attendance',           icon: BarChart3,       page: 'AllAttendance?scope=org' },
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
    { name: 'Holiday Calendar',         icon: Calendar,        page: 'HolidayCalendar' },
    { name: 'My Visitors',              icon: Users,           page: 'MyVisitors' },
    { name: 'My Payslips',              icon: CreditCard,      page: 'Payslips' },
    { name: 'My Documents',             icon: FolderOpen,      page: 'Documents' },
    { name: 'Expenses',                 icon: DollarSign,      page: 'Reimbursements' },
    { name: 'My Performance',           icon: Target,          page: 'PerformanceManagement' },
    { name: 'My Training',              icon: GraduationCap,   page: 'MyTraining' },
    { name: 'My Insurance',             icon: Shield,          page: 'MyInsurance' },
    { name: 'My Assets',                icon: Laptop,          page: 'MyAssets' },
    { name: 'My Exit',                  icon: LogOut,          page: 'MyExit' },
  ]},
  { label: 'Exit Management', items: [
    { name: 'Exit Management',          icon: LogOut,          page: 'ExitManagement' },
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

// Middle management — scoped to their own team (Employee.reporting_manager_id
// === them, plus their downstream hierarchy where a page supports it — see
// src/lib/hierarchy.js). Deliberately a trimmed-down version of
// managementMenuGroups: drops org-wide-only sections (full Recruitment
// pipeline, org-wide Talent Grid / Skill Grid, Recruitment Analytics) that a
// line manager has no authorization for and that the backend doesn't
// team-scope. AskMax AI is included (every role except gate_admin gets it —
// it answers from the asking user's own scoped data, same as every other
// page here). Every item kept here is backed by real reporting_manager_id-
// based enforcement server-side, not just hidden in the UI.
const managerMenuGroups = [
  { label: 'Overview', items: [
    { name: 'Dashboard',                icon: LayoutDashboard, page: 'Dashboard' },
    { name: 'Team MIS',                 icon: PieChart,        page: 'MISDashboard' },
  ]},
  { label: 'My Team', items: [
    { name: 'My Team',                  icon: Users,           page: 'Employees' },
    { name: 'Team Attendance',          icon: BarChart3,       page: 'AllAttendance' },
    { name: 'Leave Approvals',          icon: FileText,        page: 'LeaveManagement' },
    { name: 'Regularisation Approvals', icon: Clock,           page: 'RegularisationApproval' },
    { name: 'Expense Approvals',        icon: DollarSign,      page: 'Approvals' },
    { name: 'Gate Pass Approvals',      icon: ShieldCheck,     page: 'GatePassApproval' },
    { name: 'Comp-Off Approvals',       icon: CalendarPlus,    page: 'CompOff' },
    { name: 'Confirmation',             icon: UserCheck,       page: 'ConfirmationManagement' },
    { name: 'Team Calendar',            icon: Calendar,        page: 'TeamCalendar' },
    { name: 'Org Chart',                icon: Network,         page: 'OrgChart' },
    { name: 'Visitor Management',       icon: Users,           page: 'VisitorManagement' },
  ]},
  { label: 'Team Insights', items: [
    { name: 'Attrition Risk (AI)',      icon: ShieldAlert,     page: 'AttritionRisk' },
    { name: 'AskMax AI',                icon: Sparkles,        page: 'AskMax' },
  ]},
  { label: 'My Attendance', items: [
    { name: 'Mark Attendance',          icon: Clock,           page: 'MarkAttendance' },
    { name: 'My Attendance',            icon: Calendar,        page: 'AttendanceHistory' },
    { name: 'Regularisation',           icon: Clock,           page: 'AttendanceRegularisation' },
    { name: 'Field Duty',               icon: Route,           page: 'FieldDuty' },
  ]},
  { label: 'My Work', items: [
    { name: 'Apply Leave',              icon: FileText,        page: 'Leave' },
    { name: 'Holiday Calendar',         icon: Calendar,        page: 'HolidayCalendar' },
    { name: 'Gate Pass',                icon: ShieldCheck,     page: 'GatePassRequest' },
    { name: 'My Visitors',              icon: Users,           page: 'MyVisitors' },
    { name: 'My Payslips',              icon: CreditCard,      page: 'Payslips' },
    { name: 'My Documents',             icon: FolderOpen,      page: 'Documents' },
    { name: 'Expenses',                 icon: DollarSign,      page: 'Reimbursements' },
    { name: 'My Performance',           icon: Target,          page: 'PerformanceManagement' },
    { name: 'My Training',              icon: GraduationCap,   page: 'MyTraining' },
    { name: 'My Insurance',             icon: Shield,          page: 'MyInsurance' },
    { name: 'My Assets',                icon: Laptop,          page: 'MyAssets' },
    { name: 'My Exit',                  icon: LogOut,          page: 'MyExit' },
  ]},
  { label: 'Exit Management', items: [
    { name: 'Exit Management',          icon: LogOut,          page: 'ExitManagement' },
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
    { name: 'Night Shift Management',  icon: Moon,            page: 'NightShiftManagement' },
    { name: 'Attendance Exemption',    icon: ShieldOff,       page: 'AttendanceExemption' },
    { name: 'Geofence Eligibility',    icon: Radar,           page: 'GeofenceEligibility' },
    { name: 'Field Duty Eligibility',  icon: Route,           page: 'FieldDutyEligibility' },
  ]},
  { label: 'Leave', items: [
    { name: 'Leave Management',        icon: FileText,        page: 'LeaveManagement' },
    { name: 'Leave Dashboard',         icon: PieChart,        page: 'LeaveDashboard' },
    { name: 'Comp-Off',                icon: CalendarPlus,    page: 'CompOff' },
    { name: 'Approvals',               icon: Bell,            page: 'Approvals' },
  ]},
  { label: 'Payroll', items: [
    { name: 'Payroll',                 icon: CreditCard,      page: 'PayrollManagement' },
    { name: 'Payslip Upload',          icon: UploadCloud,     page: 'PayslipUpload' },
    { name: 'Payroll Analytics',       icon: PieChart,        page: 'PayrollAnalytics' },
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
    { name: 'Skill Grid',              icon: LayoutGrid,      page: 'SkillGrid' },
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
    { name: 'Left Employees',          icon: Archive,         page: 'LeftEmployees' },
  ]},
  { label: 'Operations', items: [
    { name: 'Departments',             icon: Building2,       page: 'DepartmentManagement' },
    { name: 'Asset Tracking',          icon: Laptop,          page: 'AssetTracking' },
    { name: 'Holiday Calendar',        icon: Calendar,        page: 'HolidayCalendar' },
    { name: 'Gate Pass Management',    icon: ShieldCheck,     page: 'GatePassManagement' },
    { name: 'Visitor Management',      icon: Users,           page: 'VisitorManagement' },
    { name: 'My Visitors',             icon: UserPlus,        page: 'MyVisitors' },
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

// Recruiter — scoped to the recruitment pipeline (job requisitions,
// candidates, interviews, offer letters, recruitment analytics) plus the
// standard employee self-service sections every role gets (attendance,
// leave, payslips, profile). No employee-management, payroll, or other
// HR-only sections — those stay HR/admin/management-only.
const recruiterMenuGroups = [
  { label: 'Overview', items: [
    { name: 'Dashboard',                icon: LayoutDashboard, page: 'Dashboard' },
  ]},
  { label: 'Recruitment', items: [
    { name: 'Job Requisitions',         icon: Briefcase,       page: 'JobRequisitions' },
    { name: 'Candidates',               icon: UserPlus,        page: 'Recruitment' },
    { name: 'Interviews',               icon: Calendar,        page: 'InterviewManagement' },
    { name: 'Offer Letters',            icon: FileSignature,   page: 'OfferLetters' },
    { name: 'Recruitment Analytics',    icon: BarChart3,       page: 'RecruitmentAnalytics' },
  ]},
  { label: 'My Attendance', items: [
    { name: 'Mark Attendance',          icon: Clock,           page: 'MarkAttendance' },
    { name: 'My Attendance',            icon: Calendar,        page: 'AttendanceHistory' },
    { name: 'Regularisation',           icon: Clock,           page: 'AttendanceRegularisation' },
  ]},
  { label: 'My Work', items: [
    { name: 'Apply Leave',              icon: FileText,        page: 'Leave' },
    { name: 'My Visitors',              icon: Users,           page: 'MyVisitors' },
    { name: 'My Payslips',              icon: CreditCard,      page: 'Payslips' },
    { name: 'My Documents',             icon: FolderOpen,      page: 'Documents' },
    { name: 'Expenses',                 icon: DollarSign,      page: 'Reimbursements' },
    { name: 'My Performance',           icon: Target,          page: 'PerformanceManagement' },
    { name: 'My Insurance',             icon: Shield,          page: 'MyInsurance' },
    { name: 'My Assets',                icon: Laptop,          page: 'MyAssets' },
    { name: 'My Exit',                  icon: LogOut,          page: 'MyExit' },
  ]},
  { label: 'Engagement', items: [
    { name: 'Announcements',            icon: Bell,            page: 'Announcements' },
    { name: 'Helpdesk',                 icon: HelpCircle,      page: 'Helpdesk' },
    { name: 'Employee Portal',          icon: Users,           page: 'EmployeeEngagementPortal' },
    { name: 'Org Chart',                icon: Network,         page: 'OrgChart' },
    { name: 'AskMax AI',                icon: Sparkles,        page: 'AskMax' },
  ]},
  { label: 'Account', items: [
    { name: 'My Profile',               icon: User2,           page: 'Profile' },
    { name: 'App Settings',             icon: SlidersHorizontal, page: 'AppSettings' },
  ]},
];

const gateAdminMenuGroups = [
  { label: '', items: [
    { name: 'Gate Admin', icon: ShieldCheck, page: 'GateAdminDashboard' },
    { name: 'Visitor Management', icon: Users, page: 'VisitorManagement' },
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
    recruiter:  'bg-[#FF2D55]',   // Apple pink
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
          : 'text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-white/5 hover:text-[#1D1D1F] dark:hover:text-white'
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
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [user,                setUser]               = useState(null);
  const [showGeoDisclosure,   setShowGeoDisclosure]  = useState(false);
  const [photoRequiredEmpId,  setPhotoRequiredEmpId] = useState(null);
  const [photoFile,           setPhotoFile]          = useState(null);
  const [photoPreview,        setPhotoPreview]       = useState('');
  const [photoUploading,      setPhotoUploading]     = useState(false);
  const [employeeDisplayName, setEmployeeDisplayName]= useState('');
  const [employeeDepartment,  setEmployeeDepartment] = useState('');
  const [myClearanceDepts,    setMyClearanceDepts]   = useState([]);
  const [isShiftManager,      setIsShiftManager]     = useState(false);
  const [moreSheetOpen,       setMoreSheetOpen]      = useState(false);
  const [pullDistance,        setPullDistance]       = useState(0);
  const [isRefreshing,        setIsRefreshing]       = useState(false);
  const [menuSearch,          setMenuSearch]         = useState('');
  const [sheetSearch,         setSheetSearch]        = useState('');

  const touchStartY = useRef(0);
  const contentRef  = useRef(null);
  const bottomNavRef = useRef(null);
  // Measured directly from the rendered <nav>, rather than guessed from CSS
  // env(safe-area-inset-bottom)/heuristics — those guesses (4.5rem, then
  // 6rem, then 8rem) kept coming up short on real devices, most likely
  // because env(safe-area-inset-bottom) isn't reliably accurate on every
  // Android WebView. offsetHeight reflects however this exact bar actually
  // rendered on this exact device, safe-area padding included, so the
  // content spacer below can never be undersized relative to it.
  const [bottomNavHeight, setBottomNavHeight] = useState(0);
  useEffect(() => {
    if (!bottomNavRef.current || typeof ResizeObserver === 'undefined') return;
    const el = bottomNavRef.current;
    // offsetHeight (not contentRect, which excludes padding/border) — the
    // bar's safe-area clearance is applied as padding, so it must be included.
    const ro = new ResizeObserver(() => setBottomNavHeight(el.offsetHeight));
    ro.observe(el);
    setBottomNavHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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

  // Adoption-analytics: heartbeat while the app is open (drives the "time
  // spent" estimate) and a page-view event per navigation (drives feature
  // adoption). Fire-and-forget — see lib/adoptionTracking.js.
  useEffect(() => { const stop = startHeartbeat(); return stop; }, []);
  useEffect(() => { logPageView(currentPageName); }, [currentPageName]);

  // Native chrome: keep the status bar in sync with the in-app theme toggle,
  // and scroll a focused input clear of the on-screen keyboard. Both are
  // no-ops on web/PWA (guarded inside nativeChrome.js) — only native builds
  // have the underlying Capacitor plugins to act on.
  useEffect(() => { initKeyboardAvoidance(); }, []);
  useEffect(() => { syncStatusBarTheme(resolvedTheme); }, [resolvedTheme]);

  // Shared by the initial login-time attempt and the app-resume retry below.
  // startBackgroundGeofence() itself already no-ops if a watcher is already
  // running, so calling this liberally (every resume) is safe and cheap —
  // it only does real work when tracking genuinely isn't active yet.
  const ensureBackgroundGeofence = useCallback(async (userId) => {
    try {
      const geo = await checkGeofenceEligibility();
      if (!geo.eligible) return;
      const disclosedKey = `bg_geo_disclosed_${userId}`;
      if (!localStorage.getItem(disclosedKey)) {
        localStorage.setItem(disclosedKey, '1');
        setShowGeoDisclosure(true);
      }
      requestBatteryOptimizationExemption().catch(() => {});
      const res = await startBackgroundGeofence();
      if (!res.started) {
        console.warn('[geofence] start attempt did not succeed, will retry on next app resume:', res.reason);
        // checkGeofenceEligibility() above already filters out the expected
        // no-op reasons (not eligible / no location configured) — anything
        // reaching here (fetch_failed, start_failed) is a genuine failure
        // that was previously invisible: it only ever hit a console log on
        // the phone itself, which nobody debugging remotely can see. Surface
        // it once per app session (not on every resume retry) so the actual
        // failure reason can be read and reported instead of guessed at.
        if (!sessionStorage.getItem('bg_geo_fail_shown')) {
          sessionStorage.setItem('bg_geo_fail_shown', '1');
          toast.error(`Background attendance tracking failed to start (${res.reason}${res.error ? ': ' + res.error : ''})`, { duration: 10000 });
        }
      } else {
        // Runs after the watcher call settles, never concurrently with it —
        // its own isolated permission escalation, see geofenceBackground.js.
        requestBackgroundLocationIfNeeded().catch(() => {});
      }
    } catch (e) {
      console.warn('ensureBackgroundGeofence:', e.message);
    }
  }, []);

  // Retries on every app resume (unlocking the phone, switching back from
  // another app) — not just once at cold launch — so a first attempt that
  // silently failed for any reason gets a genuine second chance without the
  // employee needing to do anything, let alone specifically open Mark
  // Attendance. No-op outside the native shell (import throws, caught below).
  useEffect(() => {
    if (!user) return;
    let handle;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        handle = await App.addListener('resume', () => {
          ensureBackgroundGeofence(user.id);
        });
      } catch { /* not running inside the native shell */ }
    })();
    return () => { handle?.remove(); };
  }, [user, ensureBackgroundGeofence]);

  // Android hardware back button / edge gesture — previously unhandled
  // entirely, so it either did nothing or exited the app outright depending
  // on the device, instead of navigating back through the app the way every
  // native Android app is expected to. Priority order matches what a user
  // actually expects pressing back: close whatever's on top first, THEN
  // fall back to page navigation, THEN exit only once there's truly nowhere
  // left to go.
  //   1. The "More" bottom sheet (Layout's own custom overlay, not a Radix
  //      primitive, so it needs its own explicit check).
  //   2. Any open Radix dialog/sheet/popover/dropdown (every one of them —
  //      DialogContent, Select, Popover, DropdownMenu — closes itself on an
  //      Escape keydown by Radix's own built-in handling, so dispatching one
  //      synthetic Escape event closes whichever is actually on top without
  //      this needing to know about each individual dialog in the app).
  //   3. Otherwise, real browser history — same navigate(-1) the header's
  //      visible Back button already uses, so hardware back and the on-screen
  //      Back button always agree.
  //   4. Only exit the app when there's nowhere left to go back to.
  useEffect(() => {
    let handle;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        handle = await App.addListener('backButton', ({ canGoBack }) => {
          if (moreSheetOpen) { setMoreSheetOpen(false); return; }
          const openOverlay = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]');
          if (openOverlay) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            return;
          }
          if (canGoBack) navigate(-1);
          else App.exitApp();
        });
      } catch { /* not running inside the native shell */ }
    })();
    return () => { handle?.remove(); };
  }, [moreSheetOpen, navigate]);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      try {
        const empRecords = await base44.entities.Employee.filter({ user_id: currentUser.id });
        if (empRecords.length > 0) {
          if (empRecords[0].display_name) setEmployeeDisplayName(empRecords[0].display_name);
          if (empRecords[0].department)   setEmployeeDepartment(empRecords[0].department);
          setIsShiftManager(!!empRecords[0].is_shift_manager);
          // Mandatory profile photo — covers both employees imported via
          // Import Employees (which never sets this field at all) and anyone
          // else missing one, regardless of how their record was created.
          // Skipped for employees still mid-onboarding — OnboardingForm.jsx
          // itself now requires a photo as one of its own mandatory fields,
          // no need to double-gate them here too.
          if (!empRecords[0].profile_picture_url && empRecords[0].employee_status !== 'pending_onboarding') {
            setPhotoRequiredEmpId(empRecords[0].id);
          }
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

      // Any non-HR user configured as a department clearance owner (Admin
      // Panel → Exit Clearance Owners) needs a nav path to Exit Management —
      // otherwise they have no way to act on cases assigned to them.
      try {
        const clr = await base44.functions.invoke('getMyExitClearanceRoles');
        const clrData = clr.data || clr;
        if (clrData?.success) setMyClearanceDepts(clrData.dept_keys || []);
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
      //
      // A cold app launch calling straight into a native permission-request
      // dialog is a known Android footgun: if the request fires before the
      // Activity has fully reached RESUMED, the OS can silently drop it —
      // no error, no callback, the watcher just never starts. A short delay
      // here gives the Activity time to settle before the very first
      // attempt, and ensureBackgroundGeofence is re-run on every app resume
      // (below) as a self-healing retry regardless of why an earlier
      // attempt didn't take — not relying on the employee happening to
      // open Mark Attendance (whose own effect was, until now, the only
      // thing that reliably retried this).
      setTimeout(() => ensureBackgroundGeofence(currentUser.id), 1500);
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

  // Tracking, the battery-exemption prompt, and the disclosed flag are all
  // already set the moment the modal is shown (see loadUser) — this just
  // dismisses it, since it's informational, not a gate.
  const acknowledgeGeoDisclosure = () => setShowGeoDisclosure(false);

  const handleMandatoryPhotoSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submitMandatoryPhoto = async () => {
    if (!photoFile || !photoRequiredEmpId) return;
    setPhotoUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: photoFile });
      await base44.entities.Employee.update(photoRequiredEmpId, { profile_picture_url: file_url });
      setPhotoRequiredEmpId(null);
      setPhotoFile(null);
      setPhotoPreview('');
    } catch (e) {
      console.error('Mandatory photo upload failed:', e.message);
      toast.error('Failed to upload photo — please try again');
    }
    setPhotoUploading(false);
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
  // Top-level management (director/CEO/MD) — org-wide, unchanged. Kept as a
  // distinct flag from isManager below: 'manager' is scoped middle
  // management (their own team only), never lumped in with this anymore.
  const isTopManagement = userRole === 'management' || user.role === 'management';
  const isManager     = userRole === 'manager'    || user.role === 'manager';
  const isGateAdmin  = userRole === 'gate_admin'  || user.role === 'gate_admin';
  const isRecruiter  = userRole === 'recruiter'   || user.role === 'recruiter';
  // Matches the "IT" department however HR spelled it out in Department
  // Management — exact 'it', or any variant of "Information Technology"
  // (with or without the "Information Technology" wording, hyphenated or
  // not) — not just a literal 2-letter "it" match, which silently excluded
  // anyone whose department was actually named "Information Technology".
  const itDeptLower  = employeeDepartment?.toLowerCase().trim() || '';
  const isITDept     = itDeptLower === 'it' || itDeptLower.includes('information technology');
  const isAdminDept  = employeeDepartment?.toLowerCase().includes('admin');

  const isAdmin = user.role === 'admin';

  let menuGroups = employeeMenuGroups;
  if (isHR)                 menuGroups = hrMenuGroups;
  else if (isTopManagement) menuGroups = managementMenuGroups;
  else if (isManager)       menuGroups = managerMenuGroups;
  else if (isRecruiter)     menuGroups = recruiterMenuGroups;
  else if (isGateAdmin)     menuGroups = gateAdminMenuGroups;
  if ((isITDept || isAdminDept) && !isHR) {
    menuGroups = [...menuGroups, { label: isITDept ? 'IT' : 'Assets', items: [{ name: 'Asset Tracking', icon: Laptop, page: 'AssetTracking' }] }];
  }
  // Managers, top management, and HR already have 'Exit Management' baked
  // into their base menu above — this only adds it for everyone else (plain
  // employees, recruiters, gate admins) who happens to own a configured
  // clearance department, so it's never duplicated in the nav.
  if (myClearanceDepts.length > 0 && !isHR && !isManager && !isTopManagement) {
    menuGroups = [...menuGroups, { label: 'Clearance', items: [{ name: 'Exit Management', icon: LogOut, page: 'ExitManagement' }] }];
  }
  // Unlike Exit Management, Shift Management isn't already in every role's
  // base menu — only HR/admin's (line ~262 above) has it. Add it for
  // anyone else (plain employee, manager, top management, recruiter, gate
  // admin) HR has specifically granted Employee.is_shift_manager, scoped
  // server-side to their own department (see assignEmployeeShift in
  // functions.js).
  if (isShiftManager && !isHR) {
    menuGroups = [...menuGroups, { label: 'Shift', items: [
      { name: 'Shift Management', icon: Clock, page: 'ShiftManagement' },
      { name: 'Night Shift Management', icon: Moon, page: 'NightShiftManagement' },
    ] }];
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
    : (isTopManagement || isManager)
    ? [
        { label: 'Home',      icon: LayoutDashboard, page: 'Dashboard',    path: '/Dashboard' },
        { label: 'My Team',   icon: Users,            page: 'Employees',    path: '/Employees' },
        { label: 'Attendance',icon: Clock,            page: 'MarkAttendance',path: '/MarkAttendance' },
        { label: 'Leave',     icon: FileText,         page: 'Leave',        path: '/Leave' },
      ]
    : isRecruiter
    ? [
        { label: 'Home',       icon: LayoutDashboard, page: 'Dashboard',          path: '/Dashboard' },
        { label: 'Requisitions', icon: Briefcase,     page: 'JobRequisitions',    path: '/JobRequisitions' },
        { label: 'Candidates', icon: UserPlus,        page: 'Recruitment',        path: '/Recruitment' },
        { label: 'Interviews', icon: Calendar,        page: 'InterviewManagement',path: '/InterviewManagement' },
      ]
    : isGateAdmin
    ? [
        { label: 'Gate Admin', icon: ShieldCheck,     page: 'GateAdminDashboard', path: '/GateAdminDashboard' },
        { label: 'Visitors',   icon: Users,            page: 'VisitorManagement', path: '/VisitorManagement' },
        { label: 'Profile',    icon: User2,            page: 'GateAdminProfile',  path: '/GateAdminProfile' },
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
              <img src="/favicon.svg?v=6" alt="MaxVolt" className="h-6 w-auto object-contain rounded-lg" />
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
            <img src="/favicon.svg?v=6" alt="MaxVolt" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[13px] text-[#1D1D1F] dark:text-white truncate leading-none">Maxvolt One</p>
            <p className="text-[11px] text-[#6E6E73] dark:text-[#8E8E93] mt-0.5">Human Resources</p>
          </div>
        </div>

        {/* User card */}
        <div className="px-3 py-3 border-b border-[#E0E0E5] dark:border-[#38383A]">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-[#F2F2F7] dark:bg-white/5">
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
              className="w-full pl-7 pr-3 py-1.5 text-[12.5px] rounded-lg bg-[#F2F2F7] dark:bg-white/5 border-none outline-none text-[#1D1D1F] dark:text-white placeholder-[#8E8E93] focus:ring-1 focus:ring-[#007AFF]/30"
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
            className="w-full flex items-center gap-2.5 px-3 py-[9px] rounded-xl text-[13.5px] font-medium text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F2F2F7] dark:hover:bg-white/5 hover:text-[#1D1D1F] dark:hover:text-white transition-colors"
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
          <div className="px-3 pt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-[#8E8E93]">
            <a href="/PrivacyPolicy" target="_blank" rel="noreferrer" className="hover:underline">Privacy</a>
            <span>·</span>
            <a href="/TermsOfService" target="_blank" rel="noreferrer" className="hover:underline">Terms</a>
            <span>·</span>
            <a href="/DeleteAccountRequest" className="hover:underline">Delete Account</a>
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
        {/* These four tabs are mounted directly by Layout (kept alive across
            nav so they don't lose scroll/state), not by the router's
            <Outlet>/children — so unlike every other page, they sit outside
            App.jsx's ErrorBoundary+Suspense wrapper. An uncaught render
            error in any of them (e.g. MarkAttendance) used to blank the
            entire app instead of just that tab. Each gets its own boundary
            here so a crash is contained to the one tab. */}
        {!PERSISTENT_TABS.has(currentPageName) && children}
        {mountedTabs.has('Dashboard')      && <div style={{ display: currentPageName === 'Dashboard'      ? 'block' : 'none' }}><ErrorBoundary><DashboardPage /></ErrorBoundary></div>}
        {mountedTabs.has('MarkAttendance') && <div style={{ display: currentPageName === 'MarkAttendance' ? 'block' : 'none' }}><ErrorBoundary><MarkAttendancePage /></ErrorBoundary></div>}
        {mountedTabs.has('Leave')          && <div style={{ display: currentPageName === 'Leave'          ? 'block' : 'none' }}><ErrorBoundary><LeavePage /></ErrorBoundary></div>}
        {mountedTabs.has('Profile')        && <div style={{ display: currentPageName === 'Profile'        ? 'block' : 'none' }}><ErrorBoundary><ProfilePage /></ErrorBoundary></div>}

        {/* Mobile bottom spacer — must exceed the fixed tab bar's real
            rendered height so the last item on any page scrolls clear of it
            and stays tappable. Three rounds of guessing this from CSS
            (4.5rem, 6rem, 8rem, each trying to account for
            env(safe-area-inset-bottom)) still left content hidden behind
            the bar on real devices — that value isn't reliably accurate on
            every Android WebView. Now measured directly: bottomNavHeight is
            the bar's actual offsetHeight (safe-area padding included,
            whatever it resolved to on this exact device), tracked via a
            ResizeObserver above. var(--vv-bottom-inset) is added on top
            since that's a separate additional offset the bar itself is
            positioned with (an iOS Safari toolbar quirk), plus a flat 1.5rem
            margin for comfortable clearance. Falls back to a generous fixed
            value if the bar hasn't been measured yet (first paint) or
            ResizeObserver is unavailable. */}
        <div
          className="lg:hidden"
          style={{ height: bottomNavHeight > 0 ? `calc(${bottomNavHeight}px + var(--vv-bottom-inset, 0px) + 1.5rem)` : 'calc(8rem + env(safe-area-inset-bottom) + var(--vv-bottom-inset, 0px))' }}
        />
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
              background: theme === 'dark' ? 'rgba(28,28,30,0.96)' : 'rgba(242,242,247,0.96)',
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
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-[#E0E0E5]/80 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <Avatar name={displayName} role={userRole} size="sm" />
                <div>
                  <p className="font-semibold text-[14px] text-[#1D1D1F] dark:text-white leading-tight">{displayName}</p>
                  <p className="text-[11px] text-[#6E6E73] dark:text-[#8E8E93] capitalize">{userRole?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="w-9 h-9 rounded-full bg-[#E5E5EA] dark:bg-white/10 flex items-center justify-center"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark'
                    ? <Sun className="w-4 h-4 text-[#FF9500]" />
                    : <Moon className="w-4 h-4 text-[#007AFF]" />
                  }
                </button>
                <button
                  onClick={() => { setMoreSheetOpen(false); setSheetSearch(''); }}
                  className="w-9 h-9 rounded-full bg-[#E5E5EA] dark:bg-white/10 flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>
              </div>
            </div>

            {/* Sheet search */}
            <div className="flex-shrink-0 px-4 py-2 border-b border-[#E0E0E5]/80 dark:border-white/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E8E93]" />
                <input
                  type="text"
                  value={sheetSearch}
                  onChange={e => setSheetSearch(e.target.value)}
                  placeholder="Search menu…"
                  className="w-full pl-9 pr-3 py-2 text-[14px] rounded-xl bg-[#E5E5EA]/60 dark:bg-white/5 border-none outline-none text-[#1D1D1F] dark:text-white placeholder-[#8E8E93] focus:ring-1 focus:ring-[#007AFF]/30"
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
                              : 'text-[#1D1D1F] dark:text-white hover:bg-[#E5E5EA]/60 dark:hover:bg-white/5'
                            }
                          `}
                          style={{ minHeight: 48 }}
                        >
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-[#007AFF]' : 'bg-[#E5E5EA] dark:bg-white/5'}`}>
                            <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-[#6E6E73] dark:text-[#8E8E93]'}`} />
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
            <div className="flex-shrink-0 px-3 py-2 border-t border-[#E0E0E5]/80 dark:border-white/10">
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
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-[11px] text-[#8E8E93]">
                <a href="/PrivacyPolicy" target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
                <span>·</span>
                <a href="/TermsOfService" target="_blank" rel="noreferrer" className="hover:underline">Terms of Service</a>
                <span>·</span>
                <a href="/DeleteAccountRequest" className="hover:underline">Delete Account</a>
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
        ref={bottomNavRef}
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

      {/* One-time, acknowledgment-only background-location disclosure — shown
          before the OS permission dialog for eligible employees, per Google
          Play's background-location policy. Not an opt-out: HR still
          controls eligibility, this is purely informational. */}
      <Dialog open={showGeoDisclosure} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-[95vw] sm:max-w-md"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Background Location Access
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2 leading-relaxed">
            <p>
              Your employer has enabled automatic attendance tracking for your account.
              This app collects your device's location — including while the app is
              closed or not in use — to automatically mark your attendance when you
              arrive at or leave a configured office/site location.
            </p>
            <p>
              This location data is used only for attendance and is not shared with
              third parties or used for any other form of tracking. See our{' '}
              <a href="/PrivacyPolicy" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>{' '}
              for details.
            </p>
            <p>
              After tapping "Got it", your device may show one or two system prompts —
              for location access and to allow this app to run in the background. Please
              allow both so attendance is captured reliably, even with your phone locked.
            </p>
          </div>
          <Button onClick={acknowledgeGeoDisclosure} className="w-full mt-2">Got it</Button>
        </DialogContent>
      </Dialog>

      {/* Mandatory profile photo — blocks the app until resolved. Covers both
          brand-new onboarding (as a backstop; OnboardingForm.jsx already
          requires this itself) and employees created via Import Employees,
          which never sets this field at all. Not dismissible. */}
      <Dialog open={!!photoRequiredEmpId} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-[95vw] sm:max-w-sm [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-blue-600" />
              Profile Photo Required
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Please upload a profile photo to continue. This is used to identify you across the app.
          </p>
          <div className="flex flex-col items-center gap-3 py-2">
            <label className="relative w-24 h-24 rounded-full border-2 border-dashed border-gray-300 hover:border-blue-400 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 group">
              {photoPreview ? (
                <img src={photoPreview} alt="Profile preview" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-7 h-7 text-gray-400 group-hover:text-blue-500" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleMandatoryPhotoSelect} disabled={photoUploading} />
            </label>
            <Button onClick={submitMandatoryPhoto} disabled={!photoFile || photoUploading} className="w-full">
              {photoUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uploading...</> : 'Save Photo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
