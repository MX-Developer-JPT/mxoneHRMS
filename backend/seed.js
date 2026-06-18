import db from './db.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const already = db.prepare("SELECT id FROM users WHERE email='admin@maxvoltenergy.com'").get();
if (already) { console.log('✓ Database already seeded.'); process.exit(0); }

console.log('Seeding database...');

// ── Users ──────────────────────────────────────────────────
const mkUser = (email, pass, name, first, last, role) => {
  const id = uuidv4();
  db.prepare(`INSERT INTO users(id,email,password,full_name,first_name,last_name,role,custom_role,display_name)
              VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id, email, bcrypt.hashSync(pass,10), name, first, last, role, role, name);
  return id;
};

const adminId = mkUser('admin@maxvoltenergy.com','Admin@123','Jai Tyagi','Jai','Tyagi','admin');
const hrId    = mkUser('hr@maxvoltenergy.com',   'Hr@123',   'Priya Sharma','Priya','Sharma','hr');
const emp1Id  = mkUser('ravi@maxvoltenergy.com', 'Emp@123',  'Ravi Kumar','Ravi','Kumar','employee');
const emp2Id  = mkUser('arun@maxvoltenergy.com', 'Emp@123',  'Arun Mehta','Arun','Mehta','employee');
const emp3Id  = mkUser('sanjana@maxvoltenergy.com','Emp@123','Sanjana Gupta','Sanjana','Gupta','employee');

// ── Departments ────────────────────────────────────────────
const mkEnt = (type, data, userId=null, status='active') => {
  const id = data.id || uuidv4();
  const d  = { ...data, id };
  db.prepare(`INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES(?,?,?,?,1,?)`)
    .run(id, type, userId, status, JSON.stringify(d));
  return id;
};

const deptIds = {};
[['Management','MGMT'],['HR','HR'],['Finance','FIN'],['Operations','OPS'],['IT','IT'],['Sales','SALES'],['Service','SVC']].forEach(([name,code])=>{
  deptIds[name] = mkEnt('Department',{name,code,description:`${name} Department`,ot_applicable:false});
});

// ── Default Shift ──────────────────────────────────────────
const shiftId = mkEnt('Shift',{name:'General Shift',start_time:'09:00',end_time:'18:00',grace_period_minutes:15,working_hours:9,days:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],is_default:true});

// ── Employees ──────────────────────────────────────────────
const mkEmp = (userId, code, name, dept, desig, doj) =>
  mkEnt('Employee',{user_id:userId,employee_code:code,display_name:name,department:dept,designation:desig,
    date_of_joining:doj,status:'active',employee_status:'confirmation',employment_type:'Full-Time',
    shift_id:shiftId,is_attendance_exempt:false}, userId);

mkEmp(adminId, 'MV001','Jai Tyagi',   'Management','Director',          '2024-01-01');
mkEmp(hrId,    'MV002','Priya Sharma','HR',        'HR Executive',       '2024-01-10');
mkEmp(emp1Id,  'MV003','Ravi Kumar',  'Operations','Sr. Manager – Ops',  '2024-02-01');
mkEmp(emp2Id,  'MV004','Arun Mehta',  'Finance',   'Accounts Executive', '2024-02-15');
mkEmp(emp3Id,  'MV005','Sanjana Gupta','Sales',    'Sales Executive',    '2024-03-01');

// ── Salary Structures ──────────────────────────────────────
const mkSalary = (userId, ctc, basic, hra, conv, spec) =>
  mkEnt('SalaryStructure',{user_id:userId,ctc,basic_salary:basic,hra,conveyance:conv,
    special_allowance:spec,gross_salary:basic+hra+conv+spec,
    effective_from:'2024-01-01',status:'active'}, userId);

mkSalary(adminId, 2000000, 58000, 29000, 7250,  50750);
mkSalary(hrId,    780000,  24750, 11000, 4400,  14850);
mkSalary(emp1Id,  1320000, 38000, 19000, 7600,  30400);
mkSalary(emp2Id,  520000,  19000, 7600,  3800,  7600);
mkSalary(emp3Id,  580000,  21000, 8400,  4200,  8400);

// ── Leave Policies ─────────────────────────────────────────
const polIds = {};
[['Casual Leave','CL',12],['Sick Leave','SL',12],['Earned Leave','EL',15],
 ['Maternity Leave','ML',180],['Paternity Leave','PL',5]].forEach(([name,code,days])=>{
  polIds[code] = mkEnt('LeavePolicy',{name,code,total_days:days,is_active:true,
    accrual_type:'monthly',accrual_rate:days/12,requires_approval:true,
    min_leave_duration:0.5,max_consecutive_days:15});
});

// ── Leave Balances for all employees ──────────────────────
const currentYear = new Date().getFullYear();
const allEmpIds = [adminId,hrId,emp1Id,emp2Id,emp3Id];
allEmpIds.forEach(uid=>{
  ['CL','SL','EL'].forEach(code=>{
    const pol = db.prepare("SELECT data FROM entities WHERE type='LeavePolicy' AND data LIKE ?").get(`%"code":"${code}"%`);
    if (!pol) return;
    const p = JSON.parse(pol.data);
    mkEnt('LeaveBalance',{user_id:uid,leave_policy_id:p.id,year:currentYear,
      total_allocated:p.total_days,accrued_this_year:p.total_days/2,
      used:0,pending_approval:0,available:p.total_days/2,carried_forward:0}, uid);
  });
});

// ── Holidays 2026 ──────────────────────────────────────────
[['Republic Day','2026-01-26','public'],['Holi','2026-03-14','public'],
 ['Good Friday','2026-04-03','public'],['Eid al-Fitr','2026-03-31','public'],
 ['Independence Day','2026-08-15','public'],['Gandhi Jayanti','2026-10-02','public'],
 ['Diwali','2026-10-20','public'],['Christmas','2026-12-25','public']].forEach(([name,date,type])=>{
  mkEnt('Holiday',{name,date,type,year:2026,is_working_day:false});
});

// ── Office Location ────────────────────────────────────────
mkEnt('AppLocation',{name:'Noida HQ',latitude:28.6139,longitude:77.2090,radius_meters:200,geofence_enabled:true});

// ── Sample Announcements ───────────────────────────────────
mkEnt('Announcement',{
  title:'Welcome to Maxvolt HR Portal',
  content:'The new self-hosted HR system is now live. Please update your profile and review company policies.',
  category:'general',status:'active',target_audience:'all',
  published_by:adminId,publish_date:new Date().toISOString()
}, adminId, 'active');

// ── Sample Helpdesk Categories ─────────────────────────────
[['IT Support','Hardware, software, network issues','IT Team'],
 ['HR Queries','Leave, attendance, documents','HR Team'],
 ['Payroll Issues','Salary, deductions, reimbursements','Finance Team'],
 ['Facilities','Office infra, seating, supplies','Admin Team']].forEach(([name,desc,owner])=>{
  mkEnt('HelpdeskCategory',{name,description:desc,auto_assign:false,assigned_team:owner});
});

console.log('\n✅ Seed complete!\n');
console.log('Login credentials:');
console.log('  Admin   : admin@maxvoltenergy.com  / Admin@123');
console.log('  HR      : hr@maxvoltenergy.com     / Hr@123');
console.log('  Employee: ravi@maxvoltenergy.com   / Emp@123\n');
