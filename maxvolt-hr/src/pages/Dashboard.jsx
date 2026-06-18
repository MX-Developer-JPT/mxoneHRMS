import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import EmployeeDashboard from '../components/dashboard/EmployeeDashboard';
import ManagementDashboard from '../components/dashboard/ManagementDashboard';
import HRDashboard from '../components/dashboard/HRDashboard';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => { setUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  if (!user) return null;

  const role = user.custom_role || user.role;
  if (role === 'hr' || role === 'admin') return <HRDashboard user={user} />;
  if (role === 'management') return <ManagementDashboard user={user} />;
  return <EmployeeDashboard user={user} />;
}