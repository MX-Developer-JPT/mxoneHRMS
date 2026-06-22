/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import { lazy } from 'react';

const AllAttendance = lazy(() => import('./pages/AllAttendance'));
const AttendanceRegularisation = lazy(() => import('./pages/AttendanceRegularisation'));
const RegularisationApproval = lazy(() => import('./pages/RegularisationApproval'));
const AnnouncementManagement = lazy(() => import('./pages/AnnouncementManagement'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Approvals = lazy(() => import('./pages/Approvals'));
const AttendanceHistory = lazy(() => import('./pages/AttendanceHistory'));
const AttendanceReports = lazy(() => import('./pages/AttendanceReports'));
const ComplianceReports = lazy(() => import('./pages/ComplianceReports'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DepartmentManagement = lazy(() => import('./pages/DepartmentManagement'));
const Documents = lazy(() => import('./pages/Documents'));
const EmployeeSalaryStructure = lazy(() => import('./pages/EmployeeSalaryStructure'));
const Employees = lazy(() => import('./pages/Employees'));
const Helpdesk = lazy(() => import('./pages/Helpdesk'));
const HolidayCalendar = lazy(() => import('./pages/HolidayCalendar'));
const InterviewManagement = lazy(() => import('./pages/InterviewManagement'));
const JobRequisitions = lazy(() => import('./pages/JobRequisitions'));
const Leave = lazy(() => import('./pages/Leave'));
const LeaveManagement = lazy(() => import('./pages/LeaveManagement'));
const LoanManagement = lazy(() => import('./pages/LoanManagement'));
const MarkAttendance = lazy(() => import('./pages/MarkAttendance'));
const OffCyclePayments = lazy(() => import('./pages/OffCyclePayments'));
const OnboardingApproval = lazy(() => import('./pages/OnboardingApproval'));
const PayrollAnalytics = lazy(() => import('./pages/PayrollAnalytics'));
const PayrollManagement = lazy(() => import('./pages/PayrollManagement'));
const PayrollProcessing = lazy(() => import('./pages/PayrollProcessing'));
const PayrollSettings = lazy(() => import('./pages/PayrollSettings'));
const Payslips = lazy(() => import('./pages/Payslips'));
const Performance = lazy(() => import('./pages/Performance'));
const PerformanceManagement = lazy(() => import('./pages/PerformanceManagement'));
const Profile = lazy(() => import('./pages/Profile'));
const Recruitment = lazy(() => import('./pages/Recruitment'));
const Reimbursements = lazy(() => import('./pages/Reimbursements'));
const Reports = lazy(() => import('./pages/Reports'));
const SalaryStructureManagement = lazy(() => import('./pages/SalaryStructureManagement'));
const Settings = lazy(() => import('./pages/Settings'));
const ShiftManagement = lazy(() => import('./pages/ShiftManagement'));
const UserRoleManagement = lazy(() => import('./pages/UserRoleManagement'));
const MyInsurance = lazy(() => import('./pages/MyInsurance'));
const InsuranceManagement = lazy(() => import('./pages/InsuranceManagement'));
const MISDashboard = lazy(() => import('./pages/MISDashboard'));
const AttendanceExemption = lazy(() => import('./pages/AttendanceExemption'));
const LeaveDashboard = lazy(() => import('./pages/LeaveDashboard'));
const LocationMaster = lazy(() => import('./pages/LocationMaster'));
const EmployeeDocuments = lazy(() => import('./pages/EmployeeDocuments'));
const HelpdeskCategoryManagement = lazy(() => import('./pages/HelpdeskCategoryManagement'));
const AttendanceLogDashboard = lazy(() => import('./pages/AttendanceLogDashboard'));
const AttritionRisk = lazy(() => import('./pages/AttritionRisk'));
const Recognition = lazy(() => import('./pages/Recognition'));
const GratuityReport = lazy(() => import('./pages/GratuityReport'));
const LetterGenerator = lazy(() => import('./pages/LetterGenerator'));
const Form16 = lazy(() => import('./pages/Form16'));
const StatutoryRegisters = lazy(() => import('./pages/StatutoryRegisters'));
const PulseSurveys = lazy(() => import('./pages/PulseSurveys'));
const AnomalyDetection = lazy(() => import('./pages/AnomalyDetection'));
const OfferLetters = lazy(() => import('./pages/OfferLetters'));
const OvertimeManagement = lazy(() => import('./pages/OvertimeManagement'));
const WFHTracking = lazy(() => import('./pages/WFHTracking'));
const TallyExport = lazy(() => import('./pages/TallyExport'));
const POSHCompliance = lazy(() => import('./pages/POSHCompliance'));
const DIMetrics = lazy(() => import('./pages/DIMetrics'));
const RecruitmentAnalytics = lazy(() => import('./pages/RecruitmentAnalytics'));
const WorkforcePlanning = lazy(() => import('./pages/WorkforcePlanning'));
const SkillMatrix = lazy(() => import('./pages/SkillMatrix'));
const FeedbackSystem = lazy(() => import('./pages/FeedbackSystem'));
const AttendanceNarrative = lazy(() => import('./pages/AttendanceNarrative'));
const HRDigest = lazy(() => import('./pages/HRDigest'));
const MinimumWages = lazy(() => import('./pages/MinimumWages'));
import __Layout from './Layout.jsx';



export const PAGES = {
    "AllAttendance": AllAttendance,
    "AttendanceRegularisation": AttendanceRegularisation,
    "RegularisationApproval": RegularisationApproval,
    "AnnouncementManagement": AnnouncementManagement,
    "Announcements": Announcements,
    "Approvals": Approvals,
    "AttendanceHistory": AttendanceHistory,
    "AttendanceReports": AttendanceReports,
    "ComplianceReports": ComplianceReports,
    "Dashboard": Dashboard,
    "DepartmentManagement": DepartmentManagement,
    "Documents": Documents,
    "EmployeeSalaryStructure": EmployeeSalaryStructure,
    "Employees": Employees,
    "Helpdesk": Helpdesk,
    "HolidayCalendar": HolidayCalendar,
    "InterviewManagement": InterviewManagement,
    "JobRequisitions": JobRequisitions,
    "Leave": Leave,
    "LeaveManagement": LeaveManagement,
    "LoanManagement": LoanManagement,
    "MarkAttendance": MarkAttendance,
    "OffCyclePayments": OffCyclePayments,
    "OnboardingApproval": OnboardingApproval,
    "PayrollAnalytics": PayrollAnalytics,
    "PayrollManagement": PayrollManagement,
    "PayrollProcessing": PayrollProcessing,
    "PayrollSettings": PayrollSettings,
    "Payslips": Payslips,
    "Performance": Performance,
    "PerformanceManagement": PerformanceManagement,
    "Profile": Profile,
    "Recruitment": Recruitment,
    "Reimbursements": Reimbursements,
    "Reports": Reports,
    "SalaryStructureManagement": SalaryStructureManagement,
    "Settings": Settings,
    "ShiftManagement": ShiftManagement,
    "UserRoleManagement": UserRoleManagement,
    "MyInsurance": MyInsurance,
    "InsuranceManagement": InsuranceManagement,
    "MISDashboard": MISDashboard,
    "AttendanceExemption": AttendanceExemption,
    "EmployeeDocuments": EmployeeDocuments,
    "HelpdeskCategoryManagement": HelpdeskCategoryManagement,
    "AttendanceLogDashboard": AttendanceLogDashboard,
    "LeaveDashboard": LeaveDashboard,
    "LocationMaster": LocationMaster,
    "AttritionRisk": AttritionRisk,
    "Recognition": Recognition,
    "GratuityReport": GratuityReport,
    "LetterGenerator": LetterGenerator,
    "Form16": Form16,
    "StatutoryRegisters": StatutoryRegisters,
    "PulseSurveys": PulseSurveys,
    "AnomalyDetection": AnomalyDetection,
    "OfferLetters": OfferLetters,
    "OvertimeManagement": OvertimeManagement,
    "WFHTracking": WFHTracking,
    "TallyExport": TallyExport,
    "POSHCompliance": POSHCompliance,
    "DIMetrics": DIMetrics,
    "RecruitmentAnalytics": RecruitmentAnalytics,
    "WorkforcePlanning": WorkforcePlanning,
    "SkillMatrix": SkillMatrix,
    "FeedbackSystem": FeedbackSystem,
    "AttendanceNarrative": AttendanceNarrative,
    "HRDigest": HRDigest,
    "MinimumWages": MinimumWages,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};