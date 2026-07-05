import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MobileSelect from '@/components/MobileSelect';
import { Grid3x3, RefreshCw, Star, Users, AlertCircle, Search } from 'lucide-react';
import { toast } from 'sonner';

// 9-box: x = performance (1-3), y = potential (1-3)
const BOX_META = {
  '3-3': { label: 'Stars',            color: 'bg-emerald-50 border-emerald-300', chip: 'text-emerald-700', hint: 'Promote / retain at all costs' },
  '2-3': { label: 'High Potentials',  color: 'bg-teal-50 border-teal-300',       chip: 'text-teal-700',    hint: 'Stretch assignments' },
  '1-3': { label: 'Rough Diamonds',   color: 'bg-cyan-50 border-cyan-300',       chip: 'text-cyan-700',    hint: 'Coach intensively' },
  '3-2': { label: 'High Performers',  color: 'bg-green-50 border-green-300',     chip: 'text-green-700',   hint: 'Grow into bigger roles' },
  '2-2': { label: 'Core Players',     color: 'bg-blue-50 border-blue-300',       chip: 'text-blue-700',    hint: 'Keep engaged & developing' },
  '1-2': { label: 'Inconsistent',     color: 'bg-amber-50 border-amber-300',     chip: 'text-amber-700',   hint: 'Clarify expectations' },
  '3-1': { label: 'Solid Experts',    color: 'bg-lime-50 border-lime-300',       chip: 'text-lime-700',    hint: 'Deepen specialisation' },
  '2-1': { label: 'Steady',           color: 'bg-orange-50 border-orange-300',   chip: 'text-orange-700',  hint: 'Monitor & motivate' },
  '1-1': { label: 'Underperformers',  color: 'bg-red-50 border-red-300',         chip: 'text-red-700',     hint: 'PIP or exit path' },
};
const BAND_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };

export default function TalentGrid() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [dept, setDept] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // employee row being assessed
  const [perfBand, setPerfBand] = useState('');
  const [potBand, setPotBand] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getTalentGrid', {});
      const d = res.data || res;
      if (d.success) setRows(d.employees || []);
      else toast.error(d.error || 'Failed to load talent grid');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const openAssess = (r) => {
    setEditing(r);
    setPerfBand(r.performance_band ? String(r.performance_band) : '');
    setPotBand(r.potential_band ? String(r.potential_band) : '');
    setNotes(r.notes || '');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke('saveTalentAssessment', {
        user_id: editing.user_id, performance_band: perfBand || null, potential_band: potBand || null, notes,
      });
      const d = res.data || res;
      if (d.success) { toast.success(`Assessment saved for ${editing.name}`); setEditing(null); load(); }
      else toast.error(d.error || 'Save failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSaving(false);
  };

  const departments = useMemo(() => ['all', ...new Set(rows.map(r => r.department).filter(Boolean))], [rows]);
  const filtered = useMemo(() => rows.filter(r =>
    (dept === 'all' || r.department === dept) &&
    (!search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.employee_code || '').toLowerCase().includes(search.toLowerCase()))
  ), [rows, dept, search]);

  const placed = filtered.filter(r => r.performance_band && r.potential_band);
  const unassessed = filtered.filter(r => !r.performance_band || !r.potential_band);

  const grid = useMemo(() => {
    const g = {};
    for (const key of Object.keys(BOX_META)) g[key] = [];
    for (const r of placed) g[`${r.performance_band}-${r.potential_band}`]?.push(r);
    return g;
  }, [placed]);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Grid3x3 className="w-6 h-6 text-violet-600" /> 9-Box Talent Grid
          </h1>
          <p className="text-gray-500 text-sm mt-1">Performance × potential mapping for succession planning. Performance auto-fills from the latest appraisal; potential is assessed by HR.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-48" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <MobileSelect value={dept} onValueChange={setDept} label="Department" className="w-40"
            options={departments.map(d => ({ value: d, label: d === 'all' ? 'All Departments' : d }))} />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : (
        <>
          {/* Grid */}
          <div className="overflow-x-auto pb-2">
            <div className="min-w-[720px]">
              <div className="flex">
                {/* Y axis label */}
                <div className="flex items-center justify-center w-8">
                  <span className="-rotate-90 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Potential →</span>
                </div>
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {[3, 2, 1].map(pot => [1, 2, 3].map(perf => {
                    const key = `${perf}-${pot}`;
                    const meta = BOX_META[key];
                    const people = grid[key] || [];
                    return (
                      <div key={key} className={`rounded-xl border-2 p-3 min-h-[130px] ${meta.color}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-bold uppercase tracking-wide ${meta.chip}`}>{meta.label}</span>
                          <Badge variant="outline" className="text-[10px]">{people.length}</Badge>
                        </div>
                        <p className="text-[10px] text-gray-400 mb-2">{meta.hint}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {people.map(r => (
                            <button key={r.user_id} onClick={() => openAssess(r)}
                              className="px-2 py-1 rounded-full bg-white/80 border text-[11px] font-medium text-gray-700 hover:border-violet-400 transition-colors">
                              {r.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }))}
                </div>
              </div>
              <div className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider mt-2 ml-8">Performance →</div>
            </div>
          </div>

          {/* Unassessed list */}
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" /> Not yet placed ({unassessed.length})
            </h2>
            {unassessed.length === 0 ? (
              <p className="text-sm text-gray-400">Everyone in this view is placed on the grid. 🎉</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Employee</th>
                      <th className="px-4 py-2.5 text-left">Department</th>
                      <th className="px-4 py-2.5 text-center">Latest Rating</th>
                      <th className="px-4 py-2.5 text-center">Performance</th>
                      <th className="px-4 py-2.5 text-center">Potential</th>
                      <th className="px-4 py-2.5 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassessed.map(r => (
                      <tr key={r.user_id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-800">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.employee_code} · {r.designation}</p>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{r.department || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          {r.latest_rating ? <span className="inline-flex items-center gap-1 text-amber-600 font-medium"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{r.latest_rating}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">{r.performance_band ? BAND_LABELS[r.performance_band] : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-center">{r.potential_band ? BAND_LABELS[r.potential_band] : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Button size="sm" variant="outline" onClick={() => openAssess(r)}>Assess</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Assess dialog */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Grid3x3 className="w-5 h-5 text-violet-600" /> Assess — {editing?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            {editing?.latest_rating ? (
              <p className="text-xs text-gray-500 flex items-center gap-1">Latest appraisal rating: <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /><strong>{editing.latest_rating}</strong> (auto-suggests the performance band)</p>
            ) : (
              <p className="text-xs text-amber-600">No appraisal on record — set the performance band manually.</p>
            )}
            <div>
              <Label className="text-xs text-gray-500">Performance</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[1, 2, 3].map(b => (
                  <button key={b} onClick={() => setPerfBand(String(b))}
                    className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${perfBand === String(b) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 hover:border-violet-300'}`}>
                    {BAND_LABELS[b]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Potential</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[1, 2, 3].map(b => (
                  <button key={b} onClick={() => setPotBand(String(b))}
                    className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${potBand === String(b) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 hover:border-violet-300'}`}>
                    {BAND_LABELS[b]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Notes (succession / development)</Label>
              <Textarea rows={2} className="mt-1" placeholder="e.g. Ready for team-lead role in 6 months" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={save} disabled={saving || !perfBand || !potBand}>
                {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}{saving ? 'Saving…' : 'Save Assessment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
