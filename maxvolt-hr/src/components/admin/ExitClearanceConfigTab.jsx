import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Save, Plus, Trash2, Users, X } from 'lucide-react';

const WORKFLOW_TOGGLES = [
  { key: 'require_employee_declaration', label: 'Require Employee Declaration', desc: 'Employee must digitally sign a declaration after departmental clearances are done, before HR final approval.' },
  { key: 'require_asset_verification', label: 'Require Asset Verification', desc: 'IT clearance stays blocked until every allocated asset is marked returned.' },
  { key: 'require_kra_handover', label: 'Require KRA/Responsibility Handover', desc: 'Employee is not considered fully cleared until mandatory KRA handovers are completed.' },
];

export default function ExitClearanceConfigTab() {
  const [configs, setConfigs] = useState([]);
  const [users, setUsers] = useState([]);
  const [workflowConfig, setWorkflowConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [newItem, setNewItem] = useState({});
  const [newDeptLabel, setNewDeptLabel] = useState('');
  const [addingDept, setAddingDept] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.functions.invoke('getExitClearanceConfigs', {});
      const d = r?.data || r;
      if (d.success) { setConfigs(d.configs); setUsers(d.owner_options || []); setWorkflowConfig(d.workflow_config || {}); }
      else toast.error(d.error || 'Failed to load');
    } catch (e) { toast.error('Failed to load: ' + e.message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = (deptKey, patch) => setConfigs(prev => prev.map(c => c.dept_key === deptKey ? { ...c, ...patch } : c));

  const save = async (cfg) => {
    setSaving(cfg.dept_key);
    try {
      const r = await base44.functions.invoke('saveExitClearanceConfig', cfg);
      const d = r?.data || r;
      if (d.success) toast.success(`${cfg.label} clearance settings saved`);
      else toast.error(d.error || 'Save failed');
    } catch (e) { toast.error('Save failed: ' + e.message); }
    setSaving('');
  };

  const addDepartment = async () => {
    if (!newDeptLabel.trim()) return;
    setAddingDept(true);
    try {
      const r = await base44.functions.invoke('saveExitClearanceConfig', { label: newDeptLabel.trim(), owner_user_ids: [], checklist_items: [], sla_days: 3, mandatory: true });
      const d = r?.data || r;
      if (d.success) { toast.success(`"${newDeptLabel.trim()}" department added`); setNewDeptLabel(''); await load(); }
      else toast.error(d.error || 'Failed to add department');
    } catch (e) { toast.error('Failed to add department: ' + e.message); }
    setAddingDept(false);
  };

  const deleteDepartment = async (cfg) => {
    if (!window.confirm(`Delete the "${cfg.label}" clearance department? This only affects exits initiated after this point — in-progress cases keep their existing checklist.`)) return;
    setDeleting(cfg.dept_key);
    try {
      const r = await base44.functions.invoke('deleteExitClearanceConfig', { dept_key: cfg.dept_key });
      const d = r?.data || r;
      if (d.success) { toast.success(`"${cfg.label}" removed`); setConfigs(prev => prev.filter(c => c.dept_key !== cfg.dept_key)); }
      else toast.error(d.error || 'Delete failed');
    } catch (e) { toast.error('Delete failed: ' + e.message); }
    setDeleting('');
  };

  const saveWorkflowConfig = async () => {
    setSavingWorkflow(true);
    try {
      const r = await base44.functions.invoke('saveExitWorkflowConfig', workflowConfig);
      const d = r?.data || r;
      if (d.success) toast.success('Global exit workflow settings saved');
      else toast.error(d.error || 'Save failed');
    } catch (e) { toast.error('Save failed: ' + e.message); }
    setSavingWorkflow(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading exit clearance settings...</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Assign who approves each department's exit clearance, its checklist items, and its SLA (days). Until owners are assigned here, HR/admin can act on any department as a fallback — nothing is blocked in the meantime.
        The "Working Department" clearance is always the employee's own reporting manager and doesn't need configuring here.
        Adding or removing a department only affects resignations submitted afterward — it never changes the checklist of a case already in progress.
      </p>

      {workflowConfig && (
        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">Global Exit Workflow Settings</div>
          <div className="p-4 space-y-3">
            {WORKFLOW_TOGGLES.map(t => (
              <label key={t.key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={workflowConfig[t.key] !== false}
                  onChange={e => setWorkflowConfig(p => ({ ...p, [t.key]: e.target.checked }))}
                />
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </label>
            ))}
            <div className="flex justify-end">
              <button onClick={saveWorkflowConfig} disabled={savingWorkflow} className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5">
                {savingWorkflow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save
              </button>
            </div>
          </div>
        </div>
      )}

      {configs.map(cfg => (
        <div key={cfg.dept_key} className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold flex items-center justify-between">
            <span>{cfg.label}</span>
            <button onClick={() => deleteDepartment(cfg)} disabled={deleting === cfg.dept_key} className="text-red-400 hover:text-red-600 disabled:opacity-40" title="Delete department">
              {deleting === cfg.dept_key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="p-4 space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.mandatory !== false} onChange={e => update(cfg.dept_key, { mandatory: e.target.checked })} />
              Mandatory (case cannot reach Clearance Completed until this department clears or is marked Not Applicable)
            </label>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Clearance Owners</p>
              <div className="flex flex-wrap gap-1.5">
                {users.map(u => {
                  const selected = (cfg.owner_user_ids || []).includes(u.id);
                  return (
                    <button
                      key={u.id}
                      onClick={() => update(cfg.dept_key, { owner_user_ids: selected ? cfg.owner_user_ids.filter(id => id !== u.id) : [...(cfg.owner_user_ids || []), u.id] })}
                      className={`text-xs px-2.5 py-1 rounded-full border ${selected ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
                    >
                      {u.full_name}
                    </button>
                  );
                })}
                {!users.length && <p className="text-xs text-muted-foreground italic">No users assigned yet to any department — pick from all employees below.</p>}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Checklist Items</p>
              <div className="space-y-1">
                {(cfg.checklist_items || []).map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm flex-1 bg-muted/40 rounded px-2 py-1">{item}</span>
                    <button onClick={() => update(cfg.dept_key, { checklist_items: cfg.checklist_items.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  className="flex-1 text-sm border rounded px-2 py-1 bg-background"
                  placeholder="Add checklist item..."
                  value={newItem[cfg.dept_key] || ''}
                  onChange={e => setNewItem(p => ({ ...p, [cfg.dept_key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && newItem[cfg.dept_key]?.trim()) { e.preventDefault(); update(cfg.dept_key, { checklist_items: [...(cfg.checklist_items || []), newItem[cfg.dept_key].trim()] }); setNewItem(p => ({ ...p, [cfg.dept_key]: '' })); } }}
                />
                <button
                  onClick={() => { if (newItem[cfg.dept_key]?.trim()) { update(cfg.dept_key, { checklist_items: [...(cfg.checklist_items || []), newItem[cfg.dept_key].trim()] }); setNewItem(p => ({ ...p, [cfg.dept_key]: '' })); } }}
                  className="px-2.5 py-1 rounded border hover:bg-muted"
                ><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-medium text-muted-foreground">SLA (days)</label>
                <input
                  type="number" min="1" className="ml-2 w-16 text-sm border rounded px-2 py-1 bg-background"
                  value={cfg.sla_days} onChange={e => update(cfg.dept_key, { sla_days: Number(e.target.value) || 1 })}
                />
              </div>
              <button
                onClick={() => save(cfg)}
                disabled={saving === cfg.dept_key}
                className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5"
              >
                {saving === cfg.dept_key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="border rounded-xl border-dashed p-4">
        <p className="text-sm font-medium mb-2">Add a New Clearance Department</p>
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm border rounded px-2 py-1.5 bg-background"
            placeholder="Department name, e.g. Legal / Compliance"
            value={newDeptLabel}
            onChange={e => setNewDeptLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addDepartment())}
          />
          <button
            onClick={addDepartment}
            disabled={addingDept || !newDeptLabel.trim()}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5"
          >
            {addingDept ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Add Department
          </button>
        </div>
      </div>
    </div>
  );
}
