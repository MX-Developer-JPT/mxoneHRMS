import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from 'sonner';
import { Loader2, Users, TrendingUp, Building2, Plus, Target } from 'lucide-react';

export default function WorkforcePlanning() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    department: '',
    current_count: '',
    planned_count: '',
    planned_date: '',
    notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getWorkforcePlan', {});
      setData(result.data || result);
    } catch (e) {
      toast.error('Failed to load workforce plan');
      setData({ current_headcount: [], plans: [] });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.department || !form.current_count || !form.planned_count) {
      toast.error('Department, current and planned count are required');
      return;
    }
    setSaving(true);
    try {
      await base44.functions.invoke('saveWorkforcePlan', {
        department: form.department,
        current_count: Number(form.current_count),
        planned_count: Number(form.planned_count),
        planned_date: form.planned_date,
        notes: form.notes,
      });
      toast.success('Workforce plan saved');
      setShowDialog(false);
      setForm({ department: '', current_count: '', planned_count: '', planned_date: '', notes: '' });
      await loadData();
    } catch (e) {
      toast.error('Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  const headcount = data?.current_headcount || [];
  const plans = data?.plans || [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workforce Planning</h1>
          <p className="text-gray-500 text-sm mt-1">Headcount management and future hiring plans</p>
        </div>
        <Button onClick={() => setShowDialog(true)} className="flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Plan
        </Button>
      </div>

      {headcount.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Current Headcount by Department</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {headcount.map((dept, i) => (
              <Card key={i}>
                <CardContent className="p-4 text-center">
                  <Building2 className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                  <p className="text-xs text-gray-500 mb-1 truncate">{dept.department}</p>
                  <p className="text-2xl font-bold text-gray-900">{dept.count}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" /> Workforce Plans
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {plans.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No workforce plans yet. Add one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Current</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Planned</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Delta</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Planned Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {plans.map((plan, i) => {
                    const delta = (plan.planned_count || 0) - (plan.current_count || 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{plan.department}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{plan.current_count}</td>
                        <td className="px-4 py-3 text-center text-gray-600">{plan.planned_count}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{plan.planned_date || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            plan.status === 'approved' ? 'bg-green-100 text-green-700' :
                            plan.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {plan.status || 'draft'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add Workforce Plan</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
                <input
                  type="text"
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Engineering"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Count *</label>
                  <input
                    type="number"
                    value={form.current_count}
                    onChange={e => setForm(f => ({ ...f, current_count: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Planned Count *</label>
                  <input
                    type="number"
                    value={form.planned_count}
                    onChange={e => setForm(f => ({ ...f, planned_count: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Planned Date</label>
                <input
                  type="date"
                  value={form.planned_date}
                  onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Any context or justification..."
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Save Plan
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
