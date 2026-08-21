import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Save, Plus, Trash2, Users } from 'lucide-react';

export default function ExitClearanceConfigTab() {
  const [configs, setConfigs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [newItem, setNewItem] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.functions.invoke('getExitClearanceConfigs', {});
      const d = r?.data || r;
      if (d.success) { setConfigs(d.configs); setUsers(d.owner_options || []); }
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

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading exit clearance settings...</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Assign who approves each department's exit clearance, its checklist items, and its SLA (days). Until owners are assigned here, HR/admin can act on any department as a fallback — nothing is blocked in the meantime.
        The "Working Department" clearance is always the employee's own reporting manager and doesn't need configuring here.
      </p>

      {configs.map(cfg => (
        <div key={cfg.dept_key} className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">{cfg.label}</div>
          <div className="p-4 space-y-4">
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
    </div>
  );
}
