import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Download, FileText, Search, ShieldCheck, Network, Rocket, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { ld } from '@/lib/ld';
import { downloadBase64, fmtDT } from '@/lib/mis';
import { PublishOpeningDialog } from '@/components/ld/LdOverviewTab';

const Card = ({ title, subtitle, right, children }) => (
  <section className="bg-white rounded-xl border">
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4"><div><h3 className="font-semibold text-gray-900">{title}</h3>{subtitle && <p className="text-xs text-gray-500 mt-0.5 max-w-3xl">{subtitle}</p>}</div>{right}</div>
    <div className="p-4">{children}</div>
  </section>
);

// HR / L&D: the induction's policy acknowledgements (permanent record), who still has to sign, and a preview of the org chart joiners see.
export default function LdPoliciesTab() {
  const [cov, setCov] = useState(null);
  const [rows, setRows] = useState({ rows: [], total: 0 });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [policy, setPolicy] = useState('');
  const [depts, setDepts] = useState([]);
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState('');
  const [publish, setPublish] = useState(false);
  const ps = 20;

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const loadCov = useCallback(() => ld('ld_policyCoverage').then(setCov).catch(e => toast.error(e.message)), []);
  const loadRows = useCallback(() => ld('ld_listPolicyAcks', { q: dq, policy_id: policy || undefined, page, page_size: ps }).then(setRows).catch(e => toast.error(e.message)), [dq, policy, page]);
  useEffect(() => { loadCov(); base44.entities.Department.list().then(d => setDepts((d || []).map(x => x.name).filter(Boolean).sort())).catch(() => {}); }, [loadCov]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const dl = async (kind, id) => {
    setBusy(kind + (id || ''));
    try {
      const r = await ld(kind === 'xlsx' ? 'ld_exportPolicyAcks' : 'ld_policyAckReceipt', kind === 'xlsx' ? {} : { id });
      downloadBase64(r.base64, r.filename, kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const pages = Math.max(1, Math.ceil(rows.total / ps));

  return (
    <div className="space-y-4">
      <Card title="Opening steps" subtitle="Every induction starts with the 10-minute website tour, then each HR policy (read and sign, one by one), then the department org chart and quiz."
        right={<div className="flex gap-2"><Link to={createPageUrl('CompanyPolicies')}><Button size="sm" variant="outline"><FileText className="w-4 h-4 mr-1.5" />Manage policies</Button></Link><Button size="sm" onClick={() => setPublish(true)}><Rocket className="w-4 h-4 mr-1.5" />Publish / update steps</Button></div>}>
        <p className="text-sm text-gray-600">Upload the policies (PDF) in <b>Company Policies</b> — tick &ldquo;New joiners must read and sign&rdquo;, set the order and the minimum reading time. New policies appear in running inductions automatically.</p>
      </Card>

      <Card title="Who has signed which policy" subtitle={cov ? `${cov.employees} active employees · ${cov.total_acks} signed acknowledgement(s) on record` : ''}>
        {!cov ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : !cov.policies.length ? <p className="text-sm text-gray-500">No policy is marked for the induction yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cov.policies.map(p => (
              <button key={p.id} onClick={() => { setPolicy(policy === p.id ? '' : p.id); setPage(1); }} className={`text-left rounded-lg border p-3 hover:border-blue-300 ${policy === p.id ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
                <div className="text-sm font-medium text-gray-900">{p.title}</div>
                <div className="mt-1.5 h-2 rounded-full bg-gray-200 overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${p.pct}%` }} /></div>
                <div className="text-xs text-gray-600 mt-1">{p.signed} signed · {p.pending} not yet · {p.pct}%</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="Acknowledgement register" subtitle="Permanent. Entries cannot be edited or deleted from the application. Click a policy above to filter."
        right={<Button size="sm" variant="outline" disabled={busy === 'xlsx'} onClick={() => dl('xlsx')}>{busy === 'xlsx' ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}Export to Excel</Button>}>
        <div className="flex items-center gap-2 mb-3">
          <div className="relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" /><input className="h-9 w-72 rounded-md border border-gray-300 pl-8 pr-2 text-sm" placeholder="Search employee, code, policy, department…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search acknowledgements" /></div>
          {policy && <button className="text-xs text-blue-700 underline" onClick={() => setPolicy('')}>Clear policy filter</button>}
          <span className="ml-auto text-xs text-gray-500">{rows.total} record(s)</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{['Employee', 'Department', 'Policy', 'Signed on', 'Typed signature', 'Read time', 'Receipt'].map(h => <th key={h} className="p-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{rows.rows.map(a => (
            <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50/60">
              <td className="p-2"><div className="font-medium">{a.employee_name}</div><div className="text-xs text-gray-400">{a.employee_code}</div></td><td className="p-2">{a.department}</td><td className="p-2">{a.policy_title}</td>
              <td className="p-2 whitespace-nowrap">{fmtDT(a.signed_at)}</td><td className="p-2 italic">{a.typed_name}</td><td className="p-2">{Math.floor((a.read_seconds || 0) / 60)}m {(a.read_seconds || 0) % 60}s</td>
              <td className="p-2"><button className="text-blue-700 hover:underline text-xs inline-flex items-center gap-1" disabled={busy === 'pdf' + a.id} onClick={() => dl('pdf', a.id)}><ShieldCheck className="w-3.5 h-3.5" />PDF</button></td>
            </tr>))}
            {!rows.rows.length && <tr><td colSpan={7} className="p-6 text-center text-gray-500">No acknowledgements yet.</td></tr>}</tbody>
        </table></div>
        {pages > 1 && <div className="flex items-center justify-end gap-2 mt-3 text-sm"><button className="h-8 w-8 rounded border disabled:opacity-40 flex items-center justify-center" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button><span className="text-gray-600">Page {page} of {pages}</span><button className="h-8 w-8 rounded border disabled:opacity-40 flex items-center justify-center" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button></div>}
      </Card>

      <Card title="Department org chart preview" subtitle="Exactly what a new joiner in that department studies and is quizzed on — built from the live employee records (Management = top level, their direct reports = middle level).">
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm min-w-[220px]" value={dept} onChange={e => setDept(e.target.value)}><option value="">Choose a department…</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}</select>
          {dept && <Link to={`${createPageUrl('LdDeptIntro')}?dept=${encodeURIComponent(dept)}`}><Button size="sm"><Network className="w-4 h-4 mr-1.5" />Open preview</Button></Link>}
        </div>
        <p className="text-xs text-gray-500 mt-2">If a chart looks wrong, fix the employee&apos;s department or reporting manager in their profile — the induction always uses the current records.</p>
      </Card>
      {publish && <PublishOpeningDialog onClose={() => setPublish(false)} onDone={() => { setPublish(false); loadCov(); }} />}
    </div>
  );
}
