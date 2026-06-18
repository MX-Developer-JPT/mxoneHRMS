import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings, Plus, CheckCircle, RefreshCw, X, ToggleLeft, ToggleRight } from 'lucide-react';
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';

export default function PMSConfiguration() {
  const [configs, setConfigs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    cycle_name: '', cycle_type: 'annually',
    review_period_start: '', review_period_end: '',
    self_assessment_deadline: '', manager_review_deadline: '', feedback_360_deadline: '',
    enable_360_feedback: true, enable_self_assessment: true,
    self_assessment_weightage: 30, manager_assessment_weightage: 50, feedback_360_weightage: 20,
    rating_scale_min: 1, rating_scale_max: 5, is_active: false
  });

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    const u = await base44.auth.me();
    setUser(u);
    const c = await base44.entities.PMSConfiguration.list('-created_date', 20);
    setConfigs(c || []);
    setLoading(false);
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const totalW = Number(form.self_assessment_weightage) + Number(form.manager_assessment_weightage) + Number(form.feedback_360_weightage);
    if (totalW !== 100) { alert('Weightages must sum to 100%'); setSaving(false); return; }
    await base44.entities.PMSConfiguration.create({ ...form, created_by: user?.id });
    setShowForm(false);
    setSaving(false);
    await init();
  };

  const handleToggleActive = async (config) => {
    // Deactivate all first
    for (const c of configs) {
      if (c.is_active && c.id !== config.id) await base44.entities.PMSConfiguration.update(c.id, { is_active: false });
    }
    await base44.entities.PMSConfiguration.update(config.id, { is_active: !config.is_active });
    await init();
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this cycle?')) {
      await base44.entities.PMSConfiguration.delete(id);
      await init();
    }
  };

  const isHR = user?.role === 'admin' || user?.role === 'hr';

  return (
    <div className="min-h-screen bg-gray-50">
      <UnderDevelopmentBanner pageName="PMS Settings" />
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center">
            <Settings className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">PMS Configuration</h1>
            <p className="text-xs text-gray-500">Appraisal cycles, rating scales & weightages</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isHR && <Button onClick={() => setShowForm(true)} className="bg-gray-800 hover:bg-gray-900 text-white gap-2"><Plus className="w-4 h-4" /> New Cycle</Button>}
          <Button variant="outline" size="icon" onClick={init}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin" /></div>
        ) : configs.length === 0 ? (
          <div className="bg-white border rounded-xl text-center py-16">
            <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-gray-600">No appraisal cycles configured</p>
            <p className="text-sm text-gray-400 mt-1">Create your first review cycle to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map(c => (
              <div key={c.id} className={`bg-white border rounded-xl p-5 ${c.is_active ? 'border-indigo-300 ring-1 ring-indigo-200' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-800">{c.cycle_name}</h3>
                      {c.is_active && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Active</span>}
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{c.cycle_type}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{c.review_period_start} → {c.review_period_end}</p>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                      <span>Self: <strong>{c.self_assessment_weightage}%</strong></span>
                      <span>Manager: <strong>{c.manager_assessment_weightage}%</strong></span>
                      {c.enable_360_feedback && <span>360°: <strong>{c.feedback_360_weightage}%</strong></span>}
                      <span>Scale: <strong>{c.rating_scale_min}–{c.rating_scale_max}</strong></span>
                      {c.self_assessment_deadline && <span>Self deadline: <strong>{c.self_assessment_deadline}</strong></span>}
                      {c.manager_review_deadline && <span>Manager deadline: <strong>{c.manager_review_deadline}</strong></span>}
                    </div>
                  </div>
                  {isHR && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" variant="outline" onClick={() => handleToggleActive(c)} className={c.is_active ? 'text-indigo-600 border-indigo-200' : ''}>
                        {c.is_active ? <ToggleRight className="w-4 h-4 mr-1" /> : <ToggleLeft className="w-4 h-4 mr-1" />}
                        {c.is_active ? 'Deactivate' : 'Set Active'}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(c.id)}><X className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-bold">New Appraisal Cycle</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-sm font-medium text-gray-700">Cycle Name *</label>
                  <Input className="mt-1" placeholder="e.g., Annual Review FY 2026-27" value={form.cycle_name} onChange={e => set('cycle_name', e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Cycle Type</label>
                  <Select value={form.cycle_type} onValueChange={v => set('cycle_type', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div />
                <div>
                  <label className="text-sm font-medium text-gray-700">Review Period Start *</label>
                  <Input type="date" className="mt-1" value={form.review_period_start} onChange={e => set('review_period_start', e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Review Period End *</label>
                  <Input type="date" className="mt-1" value={form.review_period_end} onChange={e => set('review_period_end', e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Self Assessment Deadline</label>
                  <Input type="date" className="mt-1" value={form.self_assessment_deadline} onChange={e => set('self_assessment_deadline', e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Manager Review Deadline</label>
                  <Input type="date" className="mt-1" value={form.manager_review_deadline} onChange={e => set('manager_review_deadline', e.target.value)} />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Assessment Weightages (must total 100%)</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Self Assessment %</label>
                    <Input type="number" min="0" max="100" className="mt-1" value={form.self_assessment_weightage} onChange={e => set('self_assessment_weightage', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Manager Assessment %</label>
                    <Input type="number" min="0" max="100" className="mt-1" value={form.manager_assessment_weightage} onChange={e => set('manager_assessment_weightage', Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">360° Feedback %</label>
                    <Input type="number" min="0" max="100" className="mt-1" value={form.feedback_360_weightage} onChange={e => set('feedback_360_weightage', Number(e.target.value))} />
                  </div>
                </div>
                <p className={`text-xs mt-1 ${Number(form.self_assessment_weightage) + Number(form.manager_assessment_weightage) + Number(form.feedback_360_weightage) === 100 ? 'text-green-600' : 'text-red-500'}`}>
                  Total: {Number(form.self_assessment_weightage) + Number(form.manager_assessment_weightage) + Number(form.feedback_360_weightage)}% {Number(form.self_assessment_weightage) + Number(form.manager_assessment_weightage) + Number(form.feedback_360_weightage) === 100 ? '✓' : '(must be 100%)'}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.enable_360_feedback} onChange={e => set('enable_360_feedback', e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm">Enable 360° Feedback</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm">Set as Active Cycle</span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving || !form.cycle_name || !form.review_period_start} className="bg-gray-800 hover:bg-gray-900 text-white">
                  {saving ? 'Saving...' : 'Create Cycle'}
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}