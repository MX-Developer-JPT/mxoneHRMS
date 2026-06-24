import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Users, Sparkles, Building2, Briefcase, Calendar } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';

function EmployeeCard({ employee, user }) {
  const displayName = employee.display_name || user?.full_name || '?';
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5 flex flex-col items-center text-center gap-3">
        {employee.profile_picture_url ? (
          <img
            src={employee.profile_picture_url}
            alt={displayName}
            className="w-20 h-20 rounded-full object-cover border-2 border-blue-100 shadow"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow">
            <span className="text-white text-2xl font-bold">{initials}</span>
          </div>
        )}
        <div>
          <p className="font-semibold text-gray-900 text-base">{displayName}</p>
          <p className="text-sm text-blue-600 font-medium">{employee.designation}</p>
          <p className="text-xs text-gray-500 mt-0.5 flex items-center justify-center gap-1">
            <Building2 className="w-3 h-3" /> {employee.department}
          </p>
        </div>
        {employee.date_of_joining && (
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Joined {safeDate(employee.date_of_joining, 'MMM yyyy')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NewJoinerCard({ employee }) {
  const displayName = employee.display_name || '?';
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 flex gap-4 items-start">
      <div className="flex-shrink-0">
        {employee.profile_picture_url ? (
          <img src={employee.profile_picture_url} alt={displayName} className="w-14 h-14 rounded-full object-cover border-2 border-blue-200" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-xl font-bold">{initials}</span>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900">{displayName}</p>
          <Badge className="bg-green-100 text-green-700 text-xs">New Joiner</Badge>
        </div>
        <p className="text-sm text-gray-500">{employee.designation} · {employee.department}</p>
        {employee.date_of_joining && (
          <p className="text-xs text-gray-400 mt-0.5">Joined {safeDate(employee.date_of_joining, 'MMM d, yyyy')}</p>
        )}
        <p className="text-sm text-gray-700 mt-2 italic">Welcome {displayName} to the team! 🎉</p>
      </div>
    </div>
  );
}

export default function EmployeeEngagementPortal() {
  const [employees, setEmployees] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const emps = await base44.entities.Employee.list('-date_of_joining', 500);
      const activeEmps = emps.filter(e =>
        e.onboarding_submitted === true &&
        (!e.status || e.status === 'active' || e.status === 'on_leave') &&
        e.department && e.department !== 'unassigned' && e.department !== 'pending' &&
        e.designation && e.designation !== 'Pending Assignment'
      );
      // New joiners = employees who joined in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const newJoiners = activeEmps
        .filter(e => e.date_of_joining && new Date(e.date_of_joining + 'T00:00:00') >= thirtyDaysAgo)
        .sort((a, b) => b.date_of_joining.localeCompare(a.date_of_joining))
        .slice(0, 10);
      setEmployees(activeEmps);
      setAnnouncements(newJoiners);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const filtered = employees.filter(emp => {
    const name = (emp.display_name || '').toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || emp.designation?.toLowerCase().includes(q) || emp.department?.toLowerCase().includes(q);
  });

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="w-8 h-8 text-blue-600" /> Employee Engagement Portal
            </h1>
            <p className="text-gray-500 mt-1">{employees.length} active employees across the organization</p>
          </div>
        </div>

        {/* New Joiners Activity */}
        {announcements.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-yellow-500" /> New Joiners Activity
            </h2>
            <div className="space-y-3">
              {announcements.map(emp => (
                <NewJoinerCard key={emp.id} employee={emp} />
              ))}
            </div>
          </div>
        )}

        {/* Employee Directory */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-blue-600" /> Employee Directory
            </h2>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Search by name, role or department..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map(emp => (
              <EmployeeCard key={emp.id} employee={emp} user={null} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">No employees found.</div>
          )}
        </div>
      </div>
    </div>
  );
}