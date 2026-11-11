import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Trash2, Upload, FileDown } from 'lucide-react';
import { ap, inputCls } from '@/lib/appraisal';

const kpi = () => ({ id: '', title: '', target: '', unit: '', weight: 0, type: 'numeric', frequency: '', rating_method: '', evidence_required: false });
const kra = () => ({ id: '', title: '', description: '', kpis: [kpi()] });
const total = (items) => items.flatMap(k => k.kpis).reduce((a, p) => a + (Number(p.weight) || 0), 0);

export default function TemplatesAdmin() {
  const [list, setList] = useState([]); const [edit, setEdit] = useState(null); const [cycles, setCycles] = useState([]); const [assign, setAssign] = useState(null); const [forms, setForms] = useState(null);
  const fileRef = useRef(null);
  const load = useCallback(async () => { try { const [t, c, f] = await Promise.all([ap('ap_list_templates'), ap('ap_list_cycles'), ap('ap_get_forms')]); setList(t.templates); setCycles(c.cycles.filter(x => x.settings && !['closed', 'archived'].includes(x.status))); setForms(f); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const upd = (ki, pi, k, v) => setEdit(e => ({ ...e, items: e.items.map((kr, i) => i !== ki ? kr : pi === null ? { ...kr, [k]: v } : { ...kr, kpis: kr.kpis.map((p, j) => j !== pi ? p : { ...p, [k]: v }) }) }));
  const save = async () => { try { await ap('ap_save_template', edit); toast.success('Template saved'); setEdit(null); load(); } catch (e) { toast.error(e.message); } };

  const importExcel = async (file) => {
    // Excel import: one row per KPI — columns: Template, Department, Designation, KRA, KPI, Target, Unit, Weight
    try {
      const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer()); const ws = wb.worksheets[0];
      const head = ws.getRow(1).values.slice(1).map(v => String(v || '').trim().toLowerCase()); const col = (n) => head.indexOf(n);
      for (const need of ['template', 'kra', 'kpi', 'weight']) if (col(need) < 0) throw new Error(`Column "${need}" is missing. Expected: Template, Department, Designation, KRA, KPI, Target, Unit, Weight`);
      const groups = {}; ws.eachRow((row, i) => { if (i === 1) return; const v = row.values.slice(1); const name = String(v[col('template')] || '').trim(); if (!name) return; const g = (groups[name] ||= { name, department: String(v[col('department')] || ''), designation: String(v[col('designation')] || ''), kras: {} }); const k = String(v[col('kra')] || 'General'); (g.kras[k] ||= []).push({ title: String(v[col('kpi')] || ''), target: v[col('target')] ?? '', unit: String(v[col('unit')] || ''), weight: Number(v[col('weight')]) || 0, type: 'numeric' }); });
      let ok = 0; const errs = [];
      for (const g of Object.values(groups)) { try { await ap('ap_save_template', { name: g.name, department: g.department, designation: g.designation, items: Object.entries(g.kras).map(([title, kpis]) => ({ title, kpis })) }); ok++; } catch (e) { errs.push(`${g.name}: ${e.message}`); } }
      toast[errs.length ? 'warning' : 'success'](`${ok} template(s) imported${errs.length ? ' · ' + errs.join(' | ') : ''}`); load();
    } catch (e) { toast.error(e.message); }
  };
  const exportExcel = async () => {
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Templates'); ws.addRow(['Template', 'Department', 'Designation', 'KRA', 'KPI', 'Target', 'Unit', 'Weight']);
    for (const t of list) for (const k of t.items) for (const p of k.kpis) ws.addRow([t.name, t.department, t.designation, k.title, p.title, p.target, p.unit, p.weight]);
    ws.getRow(1).font = { bold: true }; ws.columns.forEach(c => { c.width = 22; });
    const buf = await wb.xlsx.writeBuffer(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf])); a.download = 'KPI_Templates.xlsx'; a.click();
  };

  if (assign) return (<div className="space-y-3 max-w-2xl"><h3 className="font-semibold">Assign “{assign.t.name}” (v{assign.t.version})</h3>
    <label className="block text-sm">Cycle<select className={inputCls} value={assign.cycle_id || ''} onChange={e => setAssign({ ...assign, cycle_id: e.target.value })}><option value="">— choose —</option>{cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="block text-sm">Departments (comma separated)<input className={inputCls} value={assign.departments || ''} onChange={e => setAssign({ ...assign, departments: e.target.value })} /></label>
    <label className="block text-sm">Designations (comma separated)<input className={inputCls} value={assign.designations || ''} onChange={e => setAssign({ ...assign, designations: e.target.value })} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!assign.overwrite} onChange={e => setAssign({ ...assign, overwrite: e.target.checked })} />Also replace employee-specific KPIs (the old set stays in history)</label>
    <p className="text-xs text-slate-500">Each employee gets their own copy — later edits to the template never change an appraisal in progress. Approved or published appraisals are skipped.</p>
    <div className="flex gap-2"><Button disabled={!assign.cycle_id} onClick={async () => { const sp = (s) => (s || '').split(',').map(x => x.trim()).filter(Boolean); try { const d = await ap('ap_assign_template', { cycle_id: assign.cycle_id, template_id: assign.t.id, departments: sp(assign.departments), designations: sp(assign.designations), overwrite: !!assign.overwrite }); toast.success(`Assigned to ${d.assigned} employee(s)${d.skipped ? `, ${d.skipped} skipped` : ''}`); setAssign(null); } catch (e) { toast.error(e.message); } }}>Assign</Button><Button variant="ghost" onClick={() => setAssign(null)}>Cancel</Button></div></div>);

  if (edit) { const tot = total(edit.items); return (<div className="space-y-4">
    <div className="grid md:grid-cols-4 gap-3"><label className="block text-sm md:col-span-2">Template name<input className={inputCls} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label><label className="block text-sm">Department<input className={inputCls} value={edit.department || ''} onChange={e => setEdit({ ...edit, department: e.target.value })} /></label><label className="block text-sm">Designation<input className={inputCls} value={edit.designation || ''} onChange={e => setEdit({ ...edit, designation: e.target.value })} /></label></div>
    {edit.items.map((kr, ki) => (<div key={ki} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex gap-2"><input className={inputCls} placeholder="KRA (e.g. Project Management)" value={kr.title} onChange={e => upd(ki, null, 'title', e.target.value)} /><Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, items: edit.items.filter((_, i) => i !== ki) })}><Trash2 className="w-4 h-4" /></Button></div>
      {kr.kpis.map((p, pi) => (<div key={pi} className="grid grid-cols-12 gap-2 items-center"><input className={`${inputCls} col-span-4`} placeholder="KPI" value={p.title} onChange={e => upd(ki, pi, 'title', e.target.value)} /><input className={`${inputCls} col-span-2`} placeholder="Target" value={p.target ?? ''} onChange={e => upd(ki, pi, 'target', e.target.value)} /><input className={`${inputCls} col-span-1`} placeholder="Unit" value={p.unit} onChange={e => upd(ki, pi, 'unit', e.target.value)} />
        <select className={`${inputCls} col-span-2`} value={p.type} onChange={e => upd(ki, pi, 'type', e.target.value)}>{(forms?.kpi_types || ['numeric']).map(t => <option key={t} value={t}>{t}</option>)}</select><input type="number" className={`${inputCls} col-span-2`} placeholder="Weight %" value={p.weight} onChange={e => upd(ki, pi, 'weight', e.target.value)} />
        <Button size="sm" variant="ghost" className="col-span-1" onClick={() => setEdit({ ...edit, items: edit.items.map((k, i) => i !== ki ? k : { ...k, kpis: k.kpis.filter((_, j) => j !== pi) }) })}><Trash2 className="w-4 h-4" /></Button></div>))}
      <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, items: edit.items.map((k, i) => i !== ki ? k : { ...k, kpis: [...k.kpis, kpi()] }) })}>+ KPI</Button></div>))}
    <div className="flex items-center gap-3"><Button variant="outline" onClick={() => setEdit({ ...edit, items: [...edit.items, kra()] })}><Plus className="w-4 h-4 mr-1" />Add KRA</Button><span className={`text-sm font-medium ${tot === 100 ? 'text-emerald-700' : 'text-red-600'}`}>Total weightage: {tot}% {tot === 100 ? '✓' : '(must be exactly 100)'}</span></div>
    <div className="flex gap-2"><Button onClick={save} disabled={tot !== 100}>Save {edit.id ? `(new version ${edit.version + 1})` : 'template'}</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div></div>); }

  return (<div className="space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-lg font-semibold">KPI / KRA templates</h3><div className="flex gap-2">
    <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={e => { if (e.target.files[0]) importExcel(e.target.files[0]); e.target.value = ''; }} />
    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-1" />Import Excel</Button><Button size="sm" variant="outline" onClick={exportExcel} disabled={!list.length}><FileDown className="w-4 h-4 mr-1" />Export Excel</Button><Button size="sm" onClick={() => setEdit({ name: '', department: '', designation: '', items: [kra()], version: 0 })}><Plus className="w-4 h-4 mr-1" />New template</Button></div></div>
    {!list.length && <p className="text-sm text-slate-500">No templates yet. Create one, or import from Excel (columns: Template, Department, Designation, KRA, KPI, Target, Unit, Weight).</p>}
    {list.map(t => (<div key={t.id} className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-3"><div className="min-w-[200px]"><div className="font-semibold">{t.name} <span className="text-xs text-slate-400">v{t.version}</span></div><div className="text-xs text-slate-500">{[t.department, t.designation].filter(Boolean).join(' · ') || 'General'} · {t.items.flatMap(k => k.kpis).length} KPIs · {total(t.items)}%</div></div>
      {t.status !== 'approved' && <Badge className="bg-amber-50 text-amber-800 border-0">Draft</Badge>}
      <div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(JSON.parse(JSON.stringify(t)))}>Edit</Button><Button size="sm" onClick={() => setAssign({ t })} disabled={t.status !== 'approved'}>Assign</Button><Button size="sm" variant="ghost" onClick={async () => { if (!confirm(`Delete template "${t.name}"? Appraisals already using it keep their copy.`)) return; try { await ap('ap_delete_template', { template_id: t.id }); load(); } catch (e) { toast.error(e.message); } }}><Trash2 className="w-4 h-4" /></Button></div></div>))}
  </div>);
}
