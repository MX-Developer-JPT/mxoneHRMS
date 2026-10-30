import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import EmployeeDashboard from '../components/dashboard/EmployeeDashboard';
import ManagementDashboard from '../components/dashboard/ManagementDashboard';
import HRDashboard from '../components/dashboard/HRDashboard';
import RecruiterDashboard from '../components/dashboard/RecruiterDashboard';
import FrontDeskDashboard from '../components/dashboard/FrontDeskDashboard';
import LdTrainerDashboard from '../components/dashboard/LdTrainerDashboard';
import AnnouncementsPanel from '../components/dashboard/AnnouncementsPanel';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => { setUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  if (!user) return null;

  const role = user.custom_role || user.role;
  const wide = ['hr', 'admin', 'recruiter', 'ld_trainer'].includes(role);   // match each dashboard's own width
  let body;
  if (role === 'hr' || role === 'admin') body = <HRDashboard user={user} />;
  else if (role === 'management' || role === 'manager') body = <ManagementDashboard user={user} />;
  else if (role === 'recruiter') body = <RecruiterDashboard user={user} />;
  else if (role === 'ld_trainer') body = <LdTrainerDashboard user={user} />;
  else if (role === 'front_desk_admin') body = <FrontDeskDashboard user={user} />;
  else body = <EmployeeDashboard user={user} />;
  // Announcements come first on every role's dashboard.
  return (
    <>
      <AnnouncementsPanel user={user} width={wide ? 'max-w-7xl' : 'max-w-6xl'} />
      {body}
    </>
  );
}
