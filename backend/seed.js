import { one, run } from './db.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export default async function seed() {
  const already = await one("SELECT id FROM users WHERE email='admin@maxvoltenergy.com'");
  if (already) { console.log('✓ Database already seeded.'); return; }

  console.log('Seeding database...');

  // ── Users ──────────────────────────────────────────────────
  const mkUser = async (email, pass, name, first, last, role) => {
    const id = uuidv4();
    await run(
      `INSERT INTO users(id,email,password,full_name,first_name,last_name,role,custom_role,display_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, email, bcrypt.hashSync(pass, 10), name, first, last, role, role, name]
    );
    return id;
  };

  const adminId = await mkUser('admin@maxvoltenergy.com', 'Admin@123', 'Jai Tyagi',      'Jai',     'Tyagi',  'admin');
  const hrId    = await mkUser('hr@maxvoltenergy.com',    'Hr@123',    'Priya Sharma',   'Priya',   'Sharma', 'hr');
  const emp1Id  = await mkUser('ravi@maxvoltenergy.com',  'Emp@123',   'Ravi Kumar',     'Ravi',    'Kumar',  'employee');
  const emp2Id  = await mkUser('arun@maxvoltenergy.com',  'Emp@123',   'Arun Mehta',     'Arun',    'Mehta',  'employee');
  const emp3Id  = await mkUser('sanjana@maxvoltenergy.com','Emp@123',  'Sanjana Gupta',  'Sanjana', 'Gupta',  'employee');

  // ── Entities helper ────────────────────────────────────────
  const mkEnt = async (type, data, userId = null, status = 'active') => {
    const id = data.id || uuidv4();
    const d  = { ...data, id };
    await run(
      `INSERT INTO entities(id,type,user_id,status,is_active,data) VALUES($1,$2,$3,$4,1,$5)`,
      [id, type, userId, status, JSON.stringify(d)]
    );
    return id;
  };

  // ── Departments ────────────────────────────────────────────
  const deptIds = {};
  for (const [name, code] of [['Management','MGMT'],['HR','HR'],['Finance','FIN'],['Operations','OPS'],['IT','IT'],['Sales','SALES'],['Service','SVC']]) {
    deptIds[name] = await mkEnt('Department', { name, code, description: `${name} Department`, ot_applicable: false });
  }

  // ── Default Shift ──────────────────────────────────────────
  const shiftId = await mkEnt('Shift', {
    name: 'General Shift', start_time: '09:00', end_time: '18:00',
    grace_period_minutes: 15, working_hours: 9,
    days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], is_default: true,
  });

  // ── Employees ──────────────────────────────────────────────
  const mkEmp = (userId, code, name, dept, desig, doj) =>
    mkEnt('Employee', {
      user_id: userId, employee_code: code, display_name: name, department: dept,
      designation: desig, date_of_joining: doj, status: 'active',
      employee_status: 'confirmation', employment_type: 'Full-Time',
      shift_id: shiftId, is_attendance_exempt: false,
    }, userId);

  await mkEmp(adminId, 'MV001', 'Jai Tyagi',    'Management', 'Director',           '2024-01-01');
  await mkEmp(hrId,    'MV002', 'Priya Sharma',  'HR',         'HR Executive',       '2024-01-10');
  await mkEmp(emp1Id,  'MV003', 'Ravi Kumar',    'Operations', 'Sr. Manager – Ops',  '2024-02-01');
  await mkEmp(emp2Id,  'MV004', 'Arun Mehta',    'Finance',    'Accounts Executive', '2024-02-15');
  await mkEmp(emp3Id,  'MV005', 'Sanjana Gupta', 'Sales',      'Sales Executive',    '2024-03-01');

  // ── Salary Structures ──────────────────────────────────────
  const mkSalary = (userId, ctc, basic, hra, conv, spec) =>
    mkEnt('SalaryStructure', {
      user_id: userId, ctc, basic_salary: basic, hra, conveyance: conv,
      special_allowance: spec, gross_salary: basic + hra + conv + spec,
      effective_from: '2024-01-01', status: 'active',
    }, userId);

  await mkSalary(adminId, 2000000, 58000, 29000, 7250,  50750);
  await mkSalary(hrId,    780000,  24750, 11000, 4400,  14850);
  await mkSalary(emp1Id,  1320000, 38000, 19000, 7600,  30400);
  await mkSalary(emp2Id,  520000,  19000, 7600,  3800,  7600);
  await mkSalary(emp3Id,  580000,  21000, 8400,  4200,  8400);

  // ── Leave Policies ─────────────────────────────────────────
  const polIds = {};
  for (const [name, code, days] of [['Casual Leave','CL',12],['Sick Leave','SL',12],['Earned Leave','EL',15],['Maternity Leave','ML',180],['Paternity Leave','PL',5]]) {
    polIds[code] = await mkEnt('LeavePolicy', {
      name, code, total_days: days, is_active: true, accrual_type: 'monthly',
      accrual_rate: days / 12, requires_approval: true, min_leave_duration: 0.5, max_consecutive_days: 15,
    });
  }

  // ── Leave Balances for all employees ──────────────────────
  const currentYear = new Date().getFullYear();
  const allEmpIds = [adminId, hrId, emp1Id, emp2Id, emp3Id];
  for (const uid of allEmpIds) {
    for (const code of ['CL', 'SL', 'EL']) {
      const pol = await one(
        "SELECT data FROM entities WHERE type='LeavePolicy' AND data LIKE $1",
        [`%"code":"${code}"%`]
      );
      if (!pol) continue;
      const p = JSON.parse(pol.data);
      await mkEnt('LeaveBalance', {
        user_id: uid, leave_policy_id: p.id, year: currentYear,
        total_allocated: p.total_days, accrued_this_year: p.total_days / 2,
        used: 0, pending_approval: 0, available: p.total_days / 2, carried_forward: 0,
      }, uid);
    }
  }

  // ── Holidays 2026 ──────────────────────────────────────────
  for (const [name, date, type] of [
    ['Republic Day','2026-01-26','public'],['Holi','2026-03-14','public'],
    ['Good Friday','2026-04-03','public'],['Eid al-Fitr','2026-03-31','public'],
    ['Independence Day','2026-08-15','public'],['Gandhi Jayanti','2026-10-02','public'],
    ['Diwali','2026-10-20','public'],['Christmas','2026-12-25','public'],
  ]) {
    await mkEnt('Holiday', { name, date, type, year: 2026, is_working_day: false });
  }

  // ── Office Location ────────────────────────────────────────
  await mkEnt('AppLocation', { name: 'Noida HQ', latitude: 28.6139, longitude: 77.2090, radius_meters: 200, geofence_enabled: true });

  // ── Sample Announcements ───────────────────────────────────
  await mkEnt('Announcement', {
    title: 'Welcome to Maxvolt HR Portal',
    content: 'The new self-hosted HR system is now live. Please update your profile and review company policies.',
    category: 'general', status: 'active', target_audience: 'all',
    published_by: adminId, publish_date: new Date().toISOString(),
  }, adminId, 'active');

  // ── Sample Helpdesk Categories ─────────────────────────────
  for (const [name, desc, owner] of [
    ['IT Support','Hardware, software, network issues','IT Team'],
    ['HR Queries','Leave, attendance, documents','HR Team'],
    ['Payroll Issues','Salary, deductions, reimbursements','Finance Team'],
    ['Facilities','Office infra, seating, supplies','Admin Team'],
  ]) {
    await mkEnt('HelpdeskCategory', { name, description: desc, auto_assign: false, assigned_team: owner });
  }

  console.log('\n✅ Seed complete!\n');
  console.log('Login credentials:');
  console.log('  Admin   : admin@maxvoltenergy.com  / Admin@123');
  console.log('  HR      : hr@maxvoltenergy.com     / Hr@123');
  console.log('  Employee: ravi@maxvoltenergy.com   / Emp@123\n');
}
