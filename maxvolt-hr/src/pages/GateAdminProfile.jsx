import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Mail, LogOut, Clock, LogIn, History, ArrowRightLeft } from 'lucide-react';
import { format, isToday } from 'date-fns';

export default function GateAdminProfile() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ total: 0, today: 0, departed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);

    const passes = await base44.entities.GatePass.list('-created_date', 500);
    const todayPasses = passes.filter(p => p.created_date && isToday(new Date(p.created_date)));
    const departed = passes.filter(p => p.status === 'departed');

    setStats({
      total: passes.length,
      today: todayPasses.length,
      departed: departed.length,
    });
    setLoading(false);
  };

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Profile Card */}
        <Card className="overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-blue-700 to-indigo-700" />
          <CardContent className="relative pt-0 pb-6 px-6">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10">
              <div className="w-20 h-20 rounded-full bg-blue-600 border-4 border-white shadow-lg flex items-center justify-center">
                <ShieldCheck className="w-10 h-10 text-white" />
              </div>
              <div className="flex-1 pb-1 min-w-0">
                <h2 className="text-2xl font-bold text-gray-900 truncate">{user?.full_name}</h2>
                <p className="text-gray-500 text-sm flex items-center gap-1 mt-1 min-w-0">
                  <Mail className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{user?.email}</span>
                </p>
              </div>
              <Badge className="bg-blue-100 text-blue-800 text-sm px-3 py-1 self-start sm:self-center">
                Gate Administrator
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-gray-50">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-gray-700">{stats.total}</p>
              <p className="text-xs text-gray-500 mt-1">Total Passes</p>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-blue-700">{stats.today}</p>
              <p className="text-xs text-blue-600 mt-1">Today's Passes</p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4 text-center">
              <p className="text-3xl font-bold text-orange-700">{stats.departed}</p>
              <p className="text-xs text-orange-600 mt-1">Currently Out</p>
            </CardContent>
          </Card>
        </div>

        {/* Role Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-4 h-4" /> Role & Permissions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3 py-3 border-b">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">System Role</p>
                <Badge className="bg-blue-100 text-blue-800">Gate Administrator</Badge>
              </div>
            </div>
            <div className="py-3 border-b">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Permissions</p>
              <ul className="text-sm text-gray-700 space-y-1">
                <li className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5 text-green-500" /> View approved gate passes</li>
                <li className="flex items-center gap-2"><LogOut className="w-3.5 h-3.5 text-orange-500" /> Mark employee as departed (Out)</li>
                <li className="flex items-center gap-2"><LogIn className="w-3.5 h-3.5 text-green-500" /> Mark employee as returned (In)</li>
                <li className="flex items-center gap-2"><History className="w-3.5 h-3.5 text-blue-500" /> View gate pass history</li>
              </ul>
            </div>
            <div className="py-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Account Email</p>
              <p className="text-sm font-medium text-gray-900">{user?.email}</p>
            </div>
          </CardContent>
        </Card>

        {/* Logout */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={handleLogout}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </div>
    </div>
  );
}