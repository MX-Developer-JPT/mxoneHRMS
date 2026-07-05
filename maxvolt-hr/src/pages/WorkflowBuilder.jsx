import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import MobileSelect from '@/components/MobileSelect';
import { GitBranch, Plus, Trash2, RefreshCw, Save, ArrowDown, FileText, DollarSign, CalendarPlus, Clock, ShieldCheck, Wallet, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const MODULES = [
  { key: 'leave',          label: 'Leave Requests',        icon: FileText,     integrated: true,  note: 'Chain drives approval levels in Leave Management' },
  { key: 'expense',        label: 'Expense Claims',        icon: DollarSign,   integrated: true,  note: 'Chain drives approval levels in Approvals' },
  { key: 'comp_off',       label: 'Comp-Off Claims',       icon: CalendarPlus, integrated: true,  note: 'Enforced server-side on every decision' },
  { key: 'regularisation', label: 'Attendance Regularisation', icon: Clock,    integrated: false, note: 'Definition saved — enforcement coming next release' },
  { key: 'gate_pass',      label: 'Gate Pass',             icon: ShieldCheck,  integrated: false, note: 'Definition saved — enforcement coming next release' },
  { key: 'loan',           label: 'Loan Applications',     icon: Wallet,       integrated: false, note: 'Definition saved — enforcement coming next release' },
];

const APPROVER_TYPES = [
  { value: 'reporting_manager', label: 'Reporting Manager' },
  { value: 'hr',                label: 'HR Team' },
  { value: 'admin',             label: 'Admin' },
  { value: 'specific_user',     label: 'Specific Person…' },
];

export default function WorkflowBuilder() {
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState({});
  const [employees, setEmployees] = useState([]);
  const [editing, setEditing] = useState(null);   // module key being edited
  const [steps, setSteps] = useState([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [wfRes, emps] = await Promise.all([
        base44.functions.invoke('getApprovalWorkflows', {}),
        base44.entities.Employee.filter({ status: 'active' }).catch(() => []),
      ]);
      const d = wfRes.data || wfRes;
      if (d.success) setWorkflows(Object.fromEntries((d.workflows || []).map(w => [w.module, w])));
      setEmployees(emps);
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const openEditor = (moduleKey) => {
    const wf = workflows[moduleKey];
    setEditing(moduleKey);
    setSteps(wf?.steps?.length ? wf.steps.map(s => ({ ...s })) : [{ approver_type: 'reporting_manager' }]);
    setActive(wf ? wf.is_active !== false : true);
  };

  const setStep = (i, patch) => setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  const addStep = () => { if (steps.length < 4) setSteps(prev => [...prev, { approver_type: 'hr' }]); };
  const removeStep = (i) => setSteps(prev => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    for (const s of steps) {
      if (s.approver_type === 'specific_user' && !s.specific_user_id) { toast.error('Pick the specific person for every "Specific Person" step'); return; }
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('saveApprovalWorkflow', { module: editing, steps, is_active: active });
      const d = res.data || res;
      if (d.success) { toast.success('Workflow saved'); setEditing(null); load(); }
      else toast.error(d.error || 'Save failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSaving(false);
  };

  const empOptions = employees.map(e => ({ value: e.user_id, label: `${e.display_name || 'Employee'} (${e.employee_code || e.department || ''})` }));
  const stepLabel = (s) => s.approver_type === 'specific_user'
    ? (employees.find(e => e.user_id === s.specific_user_id)?.display_name || 'Specific person')
    : APPROVER_TYPES.find(t => t.value === s.approver_type)?.label || s.approver_type;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-violet-600" /> Approval Workflow Builder
        </h1>
        <p className="text-gray-500 text-sm mt-1">Define who approves what, in what order — up to 4 levels per module. Requests move level by level; a rejection at any level ends the request. Modules without a workflow keep their built-in flow (manager → HR).</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {MODULES.map(m => {
            const wf = workflows[m.key];
            const isEditing = editing === m.key;
            return (
              <Card key={m.key} className={isEditing ? 'border-violet-300 ring-1 ring-violet-200' : ''}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <m.icon className="w-4 h-4 text-violet-600" /> {m.label}
                    {wf?.is_active && !isEditing && <Badge className="bg-violet-100 text-violet-700 text-[10px]">CUSTOM · {wf.steps.length} level{wf.steps.length > 1 ? 's' : ''}</Badge>}
                    {wf && wf.is_active === false && !isEditing && <Badge variant="outline" className="text-[10px] text-gray-400">DISABLED</Badge>}
                    {!m.integrated && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">DEFINITION ONLY</Badge>}
                  </CardTitle>
                  {!isEditing && <Button size="sm" variant="outline" onClick={() => openEditor(m.key)}>Configure</Button>}
                </CardHeader>
                <CardContent>
                  {!isEditing ? (
                    wf?.steps?.length ? (
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="text-gray-400 text-xs">Requester</span>
                        {wf.steps.map((s, i) => (
                          <React.Fragment key={i}>
                            <span className="text-gray-300">→</span>
                            <Badge variant="outline" className="font-normal">{i + 1}. {stepLabel(s)}</Badge>
                          </React.Fragment>
                        ))}
                        <span className="text-gray-300">→</span>
                        <span className="text-green-600 text-xs font-medium">Approved</span>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">Built-in flow: Reporting Manager → HR. {m.note}.</p>
                    )
                  ) : (
                    <div className="space-y-3">
                      {steps.map((s, i) => (
                        <div key={i} className="flex items-end gap-2 flex-wrap">
                          <div className="flex items-center gap-2 text-xs text-gray-400 w-14 pb-2">
                            {i > 0 && <ArrowDown className="w-3.5 h-3.5" />} Level {i + 1}
                          </div>
                          <div className="w-48">
                            <Label className="text-xs text-gray-500">Approver</Label>
                            <MobileSelect value={s.approver_type} onValueChange={(v) => setStep(i, { approver_type: v, specific_user_id: undefined })}
                              label="Approver" className="w-full" options={APPROVER_TYPES} />
                          </div>
                          {s.approver_type === 'specific_user' && (
                            <div className="w-64">
                              <Label className="text-xs text-gray-500">Person</Label>
                              <MobileSelect value={s.specific_user_id || ''} onValueChange={(v) => setStep(i, { specific_user_id: v })}
                                label="Person" className="w-full" options={empOptions} />
                            </div>
                          )}
                          {steps.length > 1 && (
                            <Button size="sm" variant="ghost" className="text-red-500 mb-0.5" onClick={() => removeStep(i)}><Trash2 className="w-4 h-4" /></Button>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t">
                        <div className="flex items-center gap-3">
                          <Button size="sm" variant="outline" onClick={addStep} disabled={steps.length >= 4}><Plus className="w-4 h-4 mr-1" /> Add Level</Button>
                          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" /> Active
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={save} disabled={saving}>
                            {saving ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save Workflow
                          </Button>
                        </div>
                      </div>
                      {!m.integrated && (
                        <p className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> This module's screens still use the built-in flow; the saved chain will be enforced when the module is wired up.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
