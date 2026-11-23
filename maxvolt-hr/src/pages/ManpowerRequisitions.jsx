import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Search, ClipboardList, BarChart3, Settings2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { mrf, statusOf, PRIORITY_CLS, fmt, labelOf, today } from '@/lib/mrf';
import MrfForm from '@/components/mrf/MrfForm';
import MrfDetail from '@/components/mrf/MrfDetail';
import MrfDashboard from '@/components/mrf/MrfDashboard';
import MrfMasters from '@/components/mrf/MrfMasters';

const FILTERS = [['all', 'All'], ['mine', 'Raised by me'], ['approve', 'Needs my approval'], ['draft', 'Drafts'], ['pending_hm_approval', 'Pending JD approval'], ['pending_hr_publication', 'Pending publication'], ['published', 'Published'], ['closed', 'Closed']];

export default function ManpowerRequisitions() {
  const [options, setOptions] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('list');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ open: false, initial: null });
  const [searchParams] = useSearchParams();
  const [openId, setOpenId] = useState(searchParams.get('open') || null);

  const load = useCallback(async () => {
    try {
      const [opt, list, users] = await Promise.all([mrf('mrf_options'), base44.entities.JobRequisition.list('-created_date', 1000), base44.functions.invoke('getAllUsers', {}).catch(() => null)]);
      setOptions({ ...opt, users: users?.data?.users || [] });
      setRows((list || []).filter((r) => r.mrf_version === 2));
    } catch (e) { toast.error(e.message || 'Could not load requisitions'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const me = options?.me?.user_id;
  const masters = options?.masters || {};
  const nameOf = (id) => options?.employees?.find((e) => e.user_id === id)?.name || options?.users?.find((u) => u.id === id)?.full_name || '';
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'mine' && r.requested_by !== me) return false;
      if (filter === 'approve' && !(r.hiring_manager_id === me && r.status === 'pending_hm_approval')) return false;
      if (['draft', 'pending_hm_approval', 'pending_hr_publication', 'published'].includes(filter) && r.status !== filter) return false;
      if (filter === 'closed' && !['closed', 'cancelled', 'rejected'].includes(r.status)) return false;
      if (s && ![r.requisition_id, r.designation, r.department, r.location, nameOf(r.hiring_manager_id), nameOf(r.requested_by)].join(' ').toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, filter, search, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const awaiting = rows.filter((r) => r.hiring_manager_id === me && r.status === 'pending_hm_approval').length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  const canDash = options?.is_org_wide; const isHr = options?.is_hr;
  const TabBtn = ({ id, icon: Icon, children }) => (
    <button type="button" onClick={() => setTab(id)} className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 ${tab === id ? 'border-primary text-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}><Icon className="w-4 h-4" />{children}</button>
  );

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Manpower Requisitions</h1>
            <p className="text-sm text-muted-foreground mt-1">Raise hiring requests. The Hiring Manager approves the Job Description; HR publishes the job.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" asChild><Link to="/JobRequisitions">Earlier requisitions</Link></Button>
            {options?.can_create && <Button onClick={() => setForm({ open: true, initial: null })}><Plus className="w-4 h-4 mr-2" />New MRF</Button>}
          </div>
        </div>

        {awaiting > 0 && (
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-700" /> {awaiting} Job Description{awaiting > 1 ? 's' : ''} waiting for your approval.
            <button type="button" className="underline ml-1" onClick={() => { setTab('list'); setFilter('approve'); }}>Show</button></div>
        )}

        <div className="flex border-b">
          <TabBtn id="list" icon={ClipboardList}>Requisitions</TabBtn>
          {canDash && <TabBtn id="dash" icon={BarChart3}>Dashboard</TabBtn>}
          {isHr && <TabBtn id="masters" icon={Settings2}>Master configuration</TabBtn>}
        </div>

        {tab === 'list' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[220px] max-w-md"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search ID, designation, department, manager…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              {FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)}>{l}</Button>)}
            </div>
            <Card><CardContent className="p-0">
              {shown.length === 0 ? <p className="text-center text-muted-foreground py-12 text-sm">{rows.length ? 'No requisitions match.' : 'No requisitions yet. Click “New MRF” to raise one.'}</p> : (
                <div className="divide-y">
                  {shown.map((r) => {
                    const st = statusOf(r); const needsMe = r.hiring_manager_id === me && r.status === 'pending_hm_approval';
                    const overdue = r.target_hire_date && r.target_hire_date < today() && ['pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold'].includes(r.status);
                    return (
                      <button key={r.id} type="button" onClick={() => setOpenId(r.id)} className={`w-full text-left p-4 hover:bg-muted/40 ${needsMe ? 'bg-yellow-50/60' : ''}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{r.designation}</span><span className="font-mono text-xs text-muted-foreground">{r.requisition_id}</span>
                          <Badge className={st.cls}>{st.label}</Badge><Badge className={PRIORITY_CLS[r.priority] || ''}>{labelOf(masters, 'priority', r.priority)}</Badge>
                          {needsMe && <Badge className="bg-yellow-200 text-yellow-900">Needs your approval</Badge>}{overdue && <Badge className="bg-red-100 text-red-700">Overdue</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{r.department} · {r.number_of_positions} vacanc{r.number_of_positions === 1 ? 'y' : 'ies'} · {r.location || 'location tbd'} · Hiring Manager {nameOf(r.hiring_manager_id) || '—'} · raised by {nameOf(r.requested_by) || '—'} on {fmt(r.requisition_date)}{r.target_hire_date ? ` · target ${fmt(r.target_hire_date)}` : ''}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent></Card>
          </div>
        )}
        {tab === 'dash' && canDash && <MrfDashboard options={options} onOpen={setOpenId} />}
        {tab === 'masters' && isHr && <MrfMasters onChanged={load} />}
      </div>

      {form.open && <MrfForm open options={options} initial={form.initial} onClose={() => setForm({ open: false, initial: null })} onSaved={() => load()} />}
      {openId && <MrfDetail id={openId} masters={masters} onClose={() => setOpenId(null)} onChanged={load} onEdit={(rec) => { setOpenId(null); setForm({ open: true, initial: rec }); }} />}
    </div>
  );
}
