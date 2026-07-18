import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MobileSelect from '@/components/MobileSelect';
import { LayoutGrid, RefreshCw, Search, Download, Settings, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

const RATING_FILL = {
  1: 'bg-red-100 text-red-700 hover:bg-red-200 border-red-200',
  2: 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200',
  3: 'bg-green-100 text-green-700 hover:bg-green-200 border-green-200',
  4: 'bg-emerald-200 text-emerald-800 hover:bg-emerald-300 border-emerald-300',
};

export default function SkillGrid() {
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState([]);
  const [ratingLabels, setRatingLabels] = useState({});
  const [metrics, setMetrics] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newMetric, setNewMetric] = useState({ category: '', name: '' });
  const [savingMetric, setSavingMetric] = useState(false);

  useEffect(() => { loadConfig(); }, []);
  useEffect(() => { if (department) loadGrid(department); }, [department]);

  const loadConfig = async () => {
    try {
      const res = await base44.functions.invoke('getSkillGridConfig', {});
      const d = res.data || res;
      if (d.success) {
        setDepartments(d.departments || []);
        setRatingLabels(d.rating_labels || {});
        if (!department && d.departments?.length) setDepartment(d.departments[0]);
        else setLoading(false);
      } else { toast.error(d.error || 'Failed to load skill grid config'); setLoading(false); }
    } catch (e) { toast.error('Error: ' + e.message); setLoading(false); }
  };

  const loadGrid = async (dept) => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getSkillGrid', { department: dept });
      const d = res.data || res;
      if (d.success) { setMetrics(d.metrics || []); setEmployees(d.employees || []); }
      else toast.error(d.error || 'Failed to load grid');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
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
    setSavingMetric(true);
    try {
      const res = await base44.functions.invoke('saveSkillGridMetric', {
        department, category: newMetric.category.trim(), name: newMetric.name.trim(), order: metrics.length + 1,
      });
      const d = res.data || res;
      if (d.success) { toast.success('Metric added'); setNewMetric({ category: '', name: '' }); loadGrid(department); loadConfig(); }
      else toast.error(d.error || 'Failed to add metric');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSavingMetric(false);
  };

  const removeMetric = async (id, name) => {
    if (!confirm(`Remove metric "${name}"? Existing ratings for it will no longer be shown.`)) return;
    try {
      const res = await base44.functions.invoke('deleteSkillGridMetric', { id });
      const d = res.data || res;
      if (d.success) { toast.success('Metric removed'); loadGrid(department); }
      else toast.error(d.error || 'Failed to remove metric');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      toast.info('Generating export…');
      const res = await base44.functions.invoke('exportSkillGrid', { department });
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

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-indigo-600" /> Skill Grid
          </h1>
          <p className="text-gray-500 text-sm mt-1">Department-specific skill certification matrix — click a cell to cycle the rating.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-48" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <MobileSelect value={department} onValueChange={setDepartment} label="Department" className="w-48"
            options={departments.map(d => ({ value: d, label: d }))} />
          <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><Settings className="w-4 h-4 mr-1.5" /> Metrics</Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting || !department}>
            {exporting ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />} Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadGrid(department)} disabled={loading || !department}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {!departments.length && !loading ? (
        <Card><CardContent className="p-10 text-center text-gray-400">
          No departments configured yet. Click "Metrics" to define skill metrics for a department.
        </CardContent></Card>
      ) : loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {!metrics.length ? (
              <div className="p-10 text-center text-gray-400">No metrics defined for {department} yet. Click "Metrics" to add some.</div>
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
                    <tr><td colSpan={3 + metrics.length} className="text-center py-8 text-gray-400">No employees found in {department}.</td></tr>
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
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5 text-indigo-600" /> Manage Metrics — {department}</DialogTitle></DialogHeader>
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
    </div>
  );
}
