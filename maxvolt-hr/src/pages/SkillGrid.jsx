import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MobileSelect from '@/components/MobileSelect';
import { LayoutGrid, RefreshCw, Search, Download, Settings, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

const RATING_FILL = {
  1: 'bg-red-100 text-red-700 hover:bg-red-200 border-red-200',
  2: 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200',
  3: 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200',
  4: 'bg-emerald-200 text-emerald-800 hover:bg-emerald-300 border-emerald-300',
};
const GENERAL_VALUE = '__general__'; // sub-department select option for "no focus area" (sub_department = '')

export default function SkillGrid() {
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState('');
  const [subDepartment, setSubDepartment] = useState(''); // '' = General/unassigned
  const [departments, setDepartments] = useState([]);
  const [subDeptsByDept, setSubDeptsByDept] = useState({});
  const [ratingLabels, setRatingLabels] = useState({});
  const [metrics, setMetrics] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newMetric, setNewMetric] = useState({ sub_department: '', category: '', name: '' });
  const [newSubDeptMode, setNewSubDeptMode] = useState(false);
  const [savingMetric, setSavingMetric] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterEmployees, setRosterEmployees] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);

  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { if (department) loadGrid(department, subDepartment); }, [department, subDepartment]);

  const loadConfig = async () => {
    try {
      const res = await base44.functions.invoke('getSkillGridConfig', {});
      const d = res.data || res;
      if (d.success) {
        setDepartments(d.departments || []);
        setSubDeptsByDept(d.sub_departments || {});
        setRatingLabels(d.rating_labels || {});
        if (!department && d.departments?.length) setDepartment(d.departments[0]);
        else setLoading(false);
      } else { toast.error(d.error || 'Failed to load skill grid config'); setLoading(false); }
    } catch (e) { toast.error('Error: ' + e.message); setLoading(false); }
  };

  const loadGrid = async (dept, subDept) => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getSkillGrid', { department: dept, sub_department: subDept || '' });
      const d = res.data || res;
      if (d.success) { setMetrics(d.metrics || []); setEmployees(d.employees || []); }
      else toast.error(d.error || 'Failed to load grid');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const changeDepartment = (dept) => {
    setDepartment(dept);
    setSubDepartment(''); // reset to General when switching departments
  };

  const setRating = async (userId, metricId, current) => {
    const next = current >= 4 ? null : (current || 0) + 1;
    setEmployees(prev => prev.map(e => e.user_id === userId
      ? { ...e, ratings: { ...e.ratings, [metricId]: next } }
      : e));
    try {
      const res = await base44.functions.invoke('saveSkillGridRating', { user_id: userId, metric_id: metricId, rating: next });
      const d = res.data || res;
      if (!d.success) toast.error(d.error || 'Failed to save rating');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const addMetric = async () => {
    if (!newMetric.name.trim()) { toast.error('Metric name required'); return; }
    const targetSubDept = newSubDeptMode ? newMetric.sub_department.trim() : subDepartment;
    setSavingMetric(true);
    try {
      const res = await base44.functions.invoke('saveSkillGridMetric', {
        department, sub_department: targetSubDept, category: newMetric.category.trim(), name: newMetric.name.trim(), order: metrics.length + 1,
      });
      const d = res.data || res;
      if (d.success) {
        toast.success('Metric added');
        setNewMetric({ sub_department: '', category: '', name: '' });
        setNewSubDeptMode(false);
        await loadConfig();
        if (targetSubDept !== subDepartment) setSubDepartment(targetSubDept);
        else loadGrid(department, subDepartment);
      } else toast.error(d.error || 'Failed to add metric');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSavingMetric(false);
  };

  const removeMetric = async (id, name) => {
    if (!confirm(`Remove metric "${name}"? Existing ratings for it will no longer be shown.`)) return;
    try {
      const res = await base44.functions.invoke('deleteSkillGridMetric', { id });
      const d = res.data || res;
      if (d.success) { toast.success('Metric removed'); loadGrid(department, subDepartment); }
      else toast.error(d.error || 'Failed to remove metric');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      toast.info('Generating export…');
      const res = await base44.functions.invoke('exportSkillGrid', { department, sub_department: subDepartment || '' });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Export failed'); return; }
      const byteChars = atob(d.base64);
      const byteNums = new Array(byteChars.length).fill(0).map((_, i) => byteChars.charCodeAt(i));
      const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported — ${d.total_employees} employees`);
    } catch (e) { toast.error('Export error: ' + e.message); }
    setExporting(false);
  };

  const openRoster = async () => {
    setRosterOpen(true);
    setRosterLoading(true);
    try {
      const res = await base44.functions.invoke('getSkillGridDeptEmployees', { department });
      const d = res.data || res;
      if (d.success) setRosterEmployees(d.employees || []);
      else toast.error(d.error || 'Failed to load roster');
    } catch (e) { toast.error('Error: ' + e.message); }
    setRosterLoading(false);
  };

  const toggleRosterMember = (userId, checked) => {
    setRosterEmployees(prev => prev.map(e => e.user_id === userId ? { ...e, sub_department: checked ? subDepartment : '' } : e));
  };

  const saveRoster = async () => {
    setRosterSaving(true);
    try {
      const toAssign = rosterEmployees.filter(e => e.sub_department === subDepartment).map(e => e.user_id);
      const toClear = rosterEmployees.filter(e => e.sub_department !== subDepartment).map(e => e.user_id);
      if (toAssign.length) await base44.functions.invoke('assignSkillGridSubDepartment', { user_ids: toAssign, sub_department: subDepartment });
      if (toClear.length) {
        // Only clear employees who were previously in THIS focus area (avoid touching others' assignments)
        const prevInThis = employees.map(e => e.user_id);
        const clearIds = toClear.filter(id => prevInThis.includes(id));
        if (clearIds.length) await base44.functions.invoke('assignSkillGridSubDepartment', { user_ids: clearIds, sub_department: '' });
      }
      toast.success('Roster updated');
      setRosterOpen(false);
      loadGrid(department, subDepartment);
    } catch (e) { toast.error('Error: ' + e.message); }
    setRosterSaving(false);
  };

  const currentSubDepts = subDeptsByDept[department] || [];
  const subDeptOptions = [
    { value: GENERAL_VALUE, label: 'General (no focus area)' },
    ...currentSubDepts.map(s => ({ value: s, label: s })),
  ];

  // Group metrics by category (empty string = its own single-column group),
  // preserving the order they were returned in (already sorted by `order`).
  const categoryGroups = useMemo(() => {
    const order = [];
    const byCat = {};
    for (const m of metrics) {
      const key = m.category || '';
      if (!byCat[key]) { byCat[key] = []; order.push(key); }
      byCat[key].push(m);
    }
    return order.map(key => ({ category: key, metrics: byCat[key] }));
  }, [metrics]);

  const filteredEmployees = useMemo(() => employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || (e.employee_code || '').toLowerCase().includes(search.toLowerCase())
  ), [employees, search]);

  const scopeLabel = subDepartment ? `${department} — ${subDepartment}` : `${department} (General)`;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-indigo-600" /> Skill Grid
          </h1>
          <p className="text-gray-500 text-sm mt-1">Department + focus-area skill certification matrix — click a cell to cycle the rating.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-44" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <MobileSelect value={department} onValueChange={changeDepartment} label="Department" className="w-44"
            options={departments.map(d => ({ value: d, label: d }))} />
          <MobileSelect value={subDepartment || GENERAL_VALUE} onValueChange={v => setSubDepartment(v === GENERAL_VALUE ? '' : v)} label="Focus Area" className="w-52"
            options={subDeptOptions} />
          <Button variant="outline" size="sm" onClick={openRoster} disabled={!department}><Users className="w-4 h-4 mr-1.5" /> Roster</Button>
          <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><Settings className="w-4 h-4 mr-1.5" /> Metrics</Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting || !department}>
            {exporting ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />} Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadGrid(department, subDepartment)} disabled={loading || !department}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {!departments.length && !loading ? (
        <Card><CardContent className="p-10 text-center text-gray-400">
          No departments found. Departments come from active employee records.
        </CardContent></Card>
      ) : loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {!metrics.length ? (
              <div className="p-10 text-center text-gray-400">No metrics defined for {scopeLabel} yet. Click "Metrics" to add some.</div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 bg-gray-50 border-b border-r px-3 py-2 text-left font-semibold text-gray-600 min-w-[160px]">Employee</th>
                    <th rowSpan={2} className="bg-gray-50 border-b border-r px-2 py-2 text-left font-semibold text-gray-600 min-w-[100px]">Code</th>
                    <th rowSpan={2} className="bg-gray-50 border-b border-r px-2 py-2 text-left font-semibold text-gray-600 min-w-[140px]">Working Stage</th>
                    {categoryGroups.map((g, gi) => g.category ? (
                      <th key={gi} colSpan={g.metrics.length} className="bg-indigo-50 border-b border-r px-2 py-1.5 text-center font-semibold text-indigo-800 text-xs">{g.category}</th>
                    ) : g.metrics.map(m => <th key={m.id} className="bg-gray-50 border-b" />))}
                  </tr>
                  <tr>
                    {metrics.map(m => (
                      <th key={m.id} className="bg-gray-50 border-b border-r px-2 py-2 text-center font-medium text-gray-600 text-xs min-w-[110px] max-w-[130px]">
                        <span className="line-clamp-2">{m.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((e, ri) => (
                    <tr key={e.user_id} className={ri % 2 ? 'bg-gray-50/50' : ''}>
                      <td className="sticky left-0 bg-inherit border-r px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{e.name}</td>
                      <td className="border-r px-2 py-2 text-gray-500 text-xs whitespace-nowrap">{e.employee_code}</td>
                      <td className="border-r px-2 py-2 text-gray-500 text-xs whitespace-nowrap">{e.working_stage || '—'}</td>
                      {metrics.map(m => {
                        const r = e.ratings?.[m.id];
                        return (
                          <td key={m.id} className="border-r p-1 text-center">
                            <button
                              onClick={() => setRating(e.user_id, m.id, r)}
                              title={r ? ratingLabels[r] : 'Click to rate'}
                              className={`w-full min-w-[36px] h-8 rounded-md border text-xs font-bold transition-colors ${r ? RATING_FILL[r] : 'bg-white text-gray-300 border-gray-200 hover:bg-gray-50'}`}
                            >
                              {r || '—'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!filteredEmployees.length && (
                    <tr><td colSpan={3 + metrics.length} className="text-center py-8 text-gray-400">No employees in {scopeLabel}. Click "Roster" to add some.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      {!!Object.keys(ratingLabels).length && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Rating scale:</span>
          {Object.entries(ratingLabels).map(([r, label]) => (
            <span key={r} className={`px-2 py-1 rounded-md border font-medium ${RATING_FILL[r]}`}>{r} — {label}</span>
          ))}
        </div>
      )}

      {/* Manage metrics dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-600" /> Manage Metrics — {scopeLabel}</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="max-h-64 overflow-y-auto space-y-1.5 border rounded-lg p-2">
              {!metrics.length && <p className="text-gray-400 text-center py-4">No metrics yet.</p>}
              {metrics.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-800">{m.name}</p>
                    {m.category && <p className="text-xs text-gray-400">{m.category}</p>}
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => removeMetric(m.id, m.name)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs text-gray-500">Add new metric</Label>
              {!newSubDeptMode ? (
                <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setNewSubDeptMode(true)}>
                  + Create a new focus area instead of using "{subDepartment || 'General'}"
                </button>
              ) : (
                <Input placeholder="New focus area name (e.g. 2W, Packing Line)" value={newMetric.sub_department} onChange={e => setNewMetric(v => ({ ...v, sub_department: e.target.value }))} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Category (optional)" value={newMetric.category} onChange={e => setNewMetric(v => ({ ...v, category: e.target.value }))} />
                <Input placeholder="Metric name *" value={newMetric.name} onChange={e => setNewMetric(v => ({ ...v, name: e.target.value }))} />
              </div>
              <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" onClick={addMetric} disabled={savingMetric}>
                {savingMetric ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Add Metric
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage roster dialog */}
      <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-indigo-600" /> Roster — {scopeLabel}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-gray-500">Check employees who belong to this focus area. Unchecked employees stay in "General" for {department}.</p>
            {rosterLoading ? (
              <div className="text-center py-8 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-1 border rounded-lg p-2">
                {rosterEmployees.map(e => (
                  <label key={e.user_id} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600 cursor-pointer" checked={e.sub_department === subDepartment} onChange={ev => toggleRosterMember(e.user_id, ev.target.checked)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{e.name}</p>
                      <p className="text-xs text-gray-400">{e.employee_code} · {e.designation}{e.sub_department && e.sub_department !== subDepartment ? ` · currently in ${e.sub_department}` : ''}</p>
                    </div>
                  </label>
                ))}
                {!rosterEmployees.length && <p className="text-gray-400 text-center py-4">No active employees in {department}.</p>}
              </div>
            )}
            <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" onClick={saveRoster} disabled={rosterSaving || rosterLoading}>
              {rosterSaving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null} Save Roster
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
