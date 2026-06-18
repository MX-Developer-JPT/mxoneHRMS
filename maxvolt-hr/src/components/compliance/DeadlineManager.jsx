import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import DeadlineCard from './DeadlineCard';

export default function DeadlineManager({ deadlines, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', compliance_type: 'PF', due_date: '', description: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.ComplianceDeadline.create({ ...form, status: 'upcoming' });
    setForm({ title: '', compliance_type: 'PF', due_date: '', description: '' });
    setShowForm(false);
    setSaving(false);
    onRefresh();
  };

  const handleMarkComplete = async (deadline) => {
    await base44.entities.ComplianceDeadline.update(deadline.id, {
      status: 'completed',
      completed_date: new Date().toISOString().split('T')[0]
    });
    onRefresh();
  };

  const active = deadlines.filter(d => d.status !== 'completed').sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const completed = deadlines.filter(d => d.status === 'completed');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Compliance Deadlines</h3>
        <Button size="sm" onClick={() => setShowForm(!showForm)} variant="outline" className="gap-1">
          <Plus className="w-3 h-3" /> Add Deadline
        </Button>
      </div>

      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Title (e.g. PF Filing - March 2026)" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            <Select value={form.compliance_type} onValueChange={v => setForm(p => ({ ...p, compliance_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['PF', 'ESI', 'TDS', 'PT', 'LWF', 'Gratuity', 'Bonus', 'Other'].map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
            <Input placeholder="Description (optional)" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.title || !form.due_date}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {active.map(d => (
          <DeadlineCard key={d.id} deadline={d} onMarkComplete={handleMarkComplete} />
        ))}
        {active.length === 0 && <p className="text-center text-gray-400 text-sm py-4">No pending deadlines</p>}
      </div>

      {completed.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Completed</p>
          <div className="space-y-2">
            {completed.slice(0, 5).map(d => <DeadlineCard key={d.id} deadline={d} />)}
          </div>
        </div>
      )}
    </div>
  );
}