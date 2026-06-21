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
import AllAttendance from './pages/AllAttendance';
import AttendanceRegularisation from './pages/AttendanceRegularisation';
import RegularisationApproval from './pages/RegularisationApproval';
import AnnouncementManagement from './pages/AnnouncementManagement';
import Announcements from './pages/Announcements';
import Approvals from './pages/Approvals';
import AttendanceHistory from './pages/AttendanceHistory';
import AttendanceReports from './pages/AttendanceReports';
import ComplianceReports from './pages/ComplianceReports';
import Dashboard from './pages/Dashboard';
import DepartmentManagement from './pages/DepartmentManagement';
import Documents from './pages/Documents';
import EmployeeSalaryStructure from './pages/EmployeeSalaryStructure';
import Employees from './pages/Employees';
import Helpdesk from './pages/Helpdesk';
import HolidayCalendar from './pages/HolidayCalendar';
import InterviewManagement from './pages/InterviewManagement';
import JobRequisitions from './pages/JobRequisitions';
import Leave from './pages/Leave';
import LeaveManagement from './pages/LeaveManagement';
import LoanManagement from './pages/LoanManagement';
import MarkAttendance from './pages/MarkAttendance';
import OffCyclePayments from './pages/OffCyclePayments';
import OnboardingApproval from './pages/OnboardingApproval';
import PayrollAnalytics from './pages/PayrollAnalytics';
import PayrollManagement from './pages/PayrollManagement';
import PayrollProcessing from './pages/PayrollProcessing';
import PayrollSettings from './pages/PayrollSettings';
import Payslips from './pages/Payslips';
import Performance from './pages/Performance';
import PerformanceManagement from './pages/PerformanceManagement';
import Profile from './pages/Profile';
import Recruitment from './pages/Recruitment';

import Reimbursements from './pages/Reimbursements';
import Reports from './pages/Reports';
import SalaryStructureManagement from './pages/SalaryStructureManagement';
import Settings from './pages/Settings';
import ShiftManagement from './pages/ShiftManagement';
import UserRoleManagement from './pages/UserRoleManagement';
import MyInsurance from './pages/MyInsurance';
import InsuranceManagement from './pages/InsuranceManagement';
import MISDashboard from './pages/MISDashboard';
import AttendanceExemption from './pages/AttendanceExemption';
import LeaveDashboard from './pages/LeaveDashboard';
import LocationMaster from './pages/LocationMaster';
import EmployeeDocuments from './pages/EmployeeDocuments';
import HelpdeskCategoryManagement from './pages/HelpdeskCategoryManagement';
import AttendanceLogDashboard from './pages/AttendanceLogDashboard';
import AttritionRisk from './pages/AttritionRisk';
import Recognition from './pages/Recognition';
import GratuityReport from './pages/GratuityReport';
import LetterGenerator from './pages/LetterGenerator';
import Form16 from './pages/Form16';
import StatutoryRegisters from './pages/StatutoryRegisters';
import PulseSurveys from './pages/PulseSurveys';
import AnomalyDetection from './pages/AnomalyDetection';
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

}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};