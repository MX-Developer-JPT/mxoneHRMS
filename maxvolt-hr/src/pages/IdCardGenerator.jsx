import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, IdCard, Upload, Plus, Trash2, Download, Save } from 'lucide-react';
import { openPdfBlob } from '@/utils/letterhead';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BulkDownload from '@/components/idcard/BulkDownload';

const EMPTY = { employee_ref: '', name: '', designation: '', employee_id: '', doj: '', department: '', photo: '' };

// 2022-08-17 -> 17-Aug-2022 (the format printed on the card)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const cardDate = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : '';
};

// Downscales a chosen photo so the request stays small; keeps PNG transparency (cut-out photos).
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const keepAlpha = file.type === 'image/png';
      resolve(keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

// Create employee ID cards from the company template (HR / admin / front desk admin).
export default function IdCardGenerator() {
  const [form, setForm] = useState(EMPTY);
  const [batch, setBatch] = useState([]);
  const [emps, setEmps] = useState([]);
  const [empQuery, setEmpQuery] = useState('');
  const [emergency, setEmergency] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sides, setSides] = useState('both');
  const [tab, setTab] = useState('create');
  const [savingNo, setSavingNo] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    base44.functions.invoke('getIdCardConfig', {}).then(r => {
      const d = r?.data || r;
      if (d?.success) { setEmergency(d.emergency_no || ''); setCanEdit(!!d.can_edit); }
    }).catch(() => {});
    base44.entities.Employee.list().then(l => setEmps((l || []).filter(e => e.status !== 'inactive'))).catch(() => {});
  }, []);

  const matches = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return [];
    return emps.filter(e => `${e.display_name || ''} ${e.employee_code || ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [empQuery, emps]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pickEmployee = (e) => {
    setForm(f => ({
      ...f, employee_ref: e.id, name: e.display_name || '', designation: e.designation || '',
      employee_id: e.employee_code || '', department: e.department || '', doj: String(e.date_of_joining || '').slice(0, 10),
    }));
    setEmpQuery('');
  };

  const onPhoto = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image (JPG or PNG)'); return; }
    try { set('photo', await readPhoto(file)); } catch (e) { toast.error(e.message); }
  };

  const toPayload = (c) => ({ name: c.name, designation: c.designation, employee_id: c.employee_id, doj: cardDate(c.doj), department: c.department, photo_base64: c.photo || undefined });

  const validate = (c) => {
    if (!c.name.trim()) { toast.error('Enter the name'); return false; }
    if (!c.employee_id.trim()) { toast.error('Enter the employee ID'); return false; }
    return true;
  };

  const generate = async (cards) => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('generateIdCards', { cards: cards.map(toPayload), sides });
      const d = res?.data || res;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Could not generate the ID card');
      openPdfBlob(d.base64, d.filename);
      toast.success(`${d.total} ID card${d.total > 1 ? 's' : ''} ready`);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const addToBatch = () => {
    if (!validate(form)) return;
    setBatch(b => [...b, form]);
    setForm(EMPTY);
    if (fileRef.current) fileRef.current.value = '';
  };

  const saveEmergency = async () => {
    setSavingNo(true);
    try {
      const r = await base44.functions.invoke('setIdCardConfig', { emergency_no: emergency });
      const d = r?.data || r;
      if (!d?.success) throw new Error(d?.error || 'Could not save');
      toast.success('Emergency number saved for all ID cards');
    } catch (e) { toast.error(e.message); }
    setSavingNo(false);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><IdCard className="w-6 h-6 text-blue-600" />ID Cards</h1>
        <p className="text-sm text-gray-500">Create an employee ID card on the Maxvolt template (55 x 88 mm, print-ready PDF).</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="bulk">Download in bulk</TabsTrigger>
        </TabsList>
        <TabsContent value="create" className="space-y-5 mt-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Emergency number (same on every card)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input className="max-w-xs" value={emergency} onChange={e => setEmergency(e.target.value)} disabled={!canEdit} placeholder="Emergency number" />
          {canEdit
            ? <Button size="sm" variant="outline" onClick={saveEmergency} disabled={savingNo}>{savingNo ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}Save</Button>
            : <span className="text-xs text-gray-500">Set by HR / admin.</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Card details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Label className="text-xs">Fill from an employee (optional)</Label>
            <Input className="mt-1" placeholder="Search name or employee code…" value={empQuery} onChange={e => setEmpQuery(e.target.value)} />
            {matches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-md max-h-64 overflow-y-auto divide-y">
                {matches.map(e => (
                  <button key={e.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => pickEmployee(e)}>
                    <span className="font-medium">{e.display_name}</span> <span className="text-xs text-gray-500">{e.employee_code} · {e.department || '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label className="text-xs">Name *</Label><Input className="mt-1" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Full name" /></div>
            <div><Label className="text-xs">Designation</Label><Input className="mt-1" value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Senior Analyst" /></div>
            <div><Label className="text-xs">Employee ID *</Label><Input className="mt-1" value={form.employee_id} onChange={e => set('employee_id', e.target.value)} placeholder="e.g. MVE00429" /></div>
            <div><Label className="text-xs">Date of joining</Label><Input type="date" className="mt-1" value={form.doj} onChange={e => set('doj', e.target.value)} /></div>
            <div className="sm:col-span-2"><Label className="text-xs">Department</Label><Input className="mt-1" value={form.department} onChange={e => set('department', e.target.value)} placeholder="e.g. Legal & Compliance" /></div>
          </div>

          <div>
            <Label className="text-xs">Photo</Label>
            <div className="mt-1 flex items-center gap-3">
              {form.photo
                ? <img src={form.photo} alt="Preview" className="w-20 h-24 object-cover rounded-md border bg-gray-50" />
                : <div className="w-20 h-24 rounded-md border border-dashed flex items-center justify-center text-[11px] text-gray-400 text-center p-1">No photo</div>}
              <div className="space-y-1">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-1.5" />{form.photo ? 'Change photo' : 'Upload photo'}</Button>
                {form.photo && <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => { set('photo', ''); if (fileRef.current) fileRef.current.value = ''; }}>Remove</Button>}
                <p className="text-[11px] text-gray-500 max-w-xs">Use a front-facing, plain-background portrait. A PNG with a transparent background gives the cut-out look of the sample card.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">Print</Label>
            <select className="h-9 rounded-md border bg-white px-2 text-sm" value={sides} onChange={e => setSides(e.target.value)}>
              <option value="both">Front + back</option>
              <option value="front">Front only</option>
              <option value="back">Back only</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => validate(form) && generate([form])} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}Generate ID card</Button>
            <Button variant="outline" onClick={addToBatch} disabled={busy}><Plus className="w-4 h-4 mr-2" />Add to batch</Button>
          </div>
        </CardContent>
      </Card>

      {batch.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Batch ({batch.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {batch.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm">
                <div className="flex items-center gap-3">
                  {c.photo ? <img src={c.photo} alt="" className="w-8 h-10 object-cover rounded border" /> : <div className="w-8 h-10 rounded border border-dashed" />}
                  <div><div className="font-medium">{c.name}</div><div className="text-xs text-gray-500">{c.employee_id} · {c.designation || '—'}</div></div>
                </div>
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setBatch(b => b.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <Button onClick={() => generate(batch)} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}Generate {batch.length} cards (one PDF)</Button>
          </CardContent>
        </Card>
      )}
        </TabsContent>
        <TabsContent value="bulk" className="mt-4">{tab === 'bulk' && <BulkDownload />}</TabsContent>
      </Tabs>
    </div>
  );
}
