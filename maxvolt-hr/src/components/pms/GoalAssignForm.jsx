import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';

const KRA_OPTIONS = ['Sales & Revenue', 'Customer Satisfaction', 'Operational Efficiency', 'Team Development', 'Innovation', 'Quality', 'Compliance', 'Cost Management', 'Project Delivery', 'Other'];

export default function GoalAssignForm({ employees, users, reviewCycles, onSave, onClose }) {
  const [form, setForm] = useState({
    employee_user_id: '', title: '', kra: '', kpi: '', description: '',
    measurable_target: '', weightage: 20, start_date: '', end_date: '', review_cycle_id: ''
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const userMap = {};
  for (const u of (users || [])) userMap[u.id] = u;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900">Assign Goal / KPI</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Employee *</label>
            <Select value={form.employee_user_id} onValueChange={v => set('employee_user_id', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {(employees || []).map(emp => (
                  <SelectItem key={emp.user_id} value={emp.user_id}>
                    {userMap[emp.user_id]?.full_name || emp.user_id} — {emp.designation}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">KRA (Key Result Area) *</label>
              <Select value={form.kra} onValueChange={v => set('kra', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select KRA" /></SelectTrigger>
                <SelectContent>
                  {KRA_OPTIONS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">KPI (Key Performance Indicator) *</label>
              <Input className="mt-1" placeholder="e.g., Monthly Sales Target" value={form.kpi} onChange={e => set('kpi', e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Goal Title *</label>
            <Input className="mt-1" placeholder="e.g., Achieve 15% sales growth in Q1" value={form.title} onChange={e => set('title', e.target.value)} required />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea className="w-full mt-1 border rounded-lg p-2 text-sm resize-none" rows={2} placeholder="Detailed description..." value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Measurable Target *</label>
            <Input className="mt-1" placeholder="e.g., Close 20 deals, Score 4.5+ CSAT" value={form.measurable_target} onChange={e => set('measurable_target', e.target.value)} required />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Weightage (%) *</label>
              <Input type="number" min="1" max="100" className="mt-1" value={form.weightage} onChange={e => set('weightage', Number(e.target.value))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Start Date</label>
              <Input type="date" className="mt-1" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">End Date *</label>
              <Input type="date" className="mt-1" value={form.end_date} onChange={e => set('end_date', e.target.value)} required />
            </div>
          </div>

          {reviewCycles?.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700">Link to Review Cycle</label>
              <Select value={form.review_cycle_id} onValueChange={v => set('review_cycle_id', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select cycle (optional)" /></SelectTrigger>
                <SelectContent>
                  {reviewCycles.map(c => <SelectItem key={c.id} value={c.id}>{c.cycle_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={saving || !form.employee_user_id || !form.title} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? 'Assigning...' : 'Assign Goal'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}