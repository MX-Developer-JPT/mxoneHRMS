import { useEffect, useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Search, Info, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { mis, num, SEV_CLS } from '@/lib/mis';

export const Section = ({ title, subtitle, right, children, className = '' }) => (
  <section className={`bg-white rounded-xl border border-gray-200 ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
      <div><h3 className="font-semibold text-gray-900">{title}</h3>{subtitle && <p className="text-xs text-gray-500 mt-0.5 max-w-3xl">{subtitle}</p>}</div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

export const Pill = ({ sev, children }) => <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full border ${SEV_CLS[sev] || SEV_CLS.Low}`}>{children ?? sev}</span>;

export const Unavailable = ({ children }) => (
  <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-3"><Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" /><span>{children}</span></div>
);

// change vs the comparison period — colour follows whether "more" is good for that KPI
export function Chg({ k, compact = false }) {
  if (!k || k.prev == null) return <span className="text-[11px] text-gray-400">no comparison</span>;
  const good = k.better === 'neutral' ? null : (k.dir === 'up') === (k.better === 'up');
  const tone = k.dir === 'flat' || good == null ? 'text-gray-500' : good ? 'text-green-700' : 'text-red-700';
  const Icon = k.dir === 'up' ? ArrowUp : k.dir === 'down' ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${tone}`}>
      <Icon className="w-3 h-3" />
      {k.abs > 0 ? '+' : ''}{num(k.abs)}{k.pct != null ? ` (${k.pct > 0 ? '+' : ''}${k.pct}%)` : ''}
      {!compact && k.note && <span className="text-gray-400">· {k.note}</span>}
    </span>
  );
}

export function KpiGrid({ kpis, onOpen }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {kpis.map(k => (
        <button key={k.key} type="button" onClick={() => onOpen?.(k.link, k)} className="text-left rounded-xl border border-gray-200 bg-white p-3 hover:border-blue-300 hover:shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-300" aria-label={`${k.label}: ${k.value}. ${k.help}`}>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-medium text-gray-500 leading-tight">{k.label}</span>
            <span title={k.help} className="text-gray-300 hover:text-gray-500 cursor-help"><Info className="w-3.5 h-3.5" /></span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5"><span className="text-2xl font-bold text-gray-900">{num(k.value)}</span><span className="text-[10px] text-gray-400">{k.unit}</span></div>
          <div className="mt-0.5"><Chg k={k} /></div>
          <div className="text-[10px] text-gray-400 mt-0.5 min-h-[12px]">{k.prev != null ? `was ${num(k.prev)}` : ''}{k.sub ? `${k.prev != null ? ' · ' : ''}${k.sub}` : ''}</div>
        </button>
      ))}
    </div>
  );
}

// Plain table for small summaries
export function MiniTable({ heads, rows, empty = 'Nothing to show.', className = '' }) {
  if (!rows?.length) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{heads.map((h, i) => <th key={i} className="p-2 whitespace-nowrap font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0 hover:bg-gray-50/60">{r.map((c, j) => <td key={j} className="p-2 align-top">{c ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Server-side paginated + searchable register (never loads a full register into the browser).
export function Register({ kind, params, columns, title, subtitle, pageSize = 25, right }) {
  const [state, setState] = useState({ rows: [], total: 0, page: 1 });
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const key = JSON.stringify(params);

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [key, kind]);
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true); setErr('');
    mis('getMisRegister', { ...params, kind, page, page_size: pageSize, q: dq })
      .then(d => { if (my === seq.current) setState({ rows: d.rows, total: d.total, page: d.page }); })
      .catch(e => { if (my === seq.current) setErr(e.message); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [key, kind, page, dq, pageSize]);

  const pages = Math.max(1, Math.ceil(state.total / pageSize));
  return (
    <Section title={title} subtitle={subtitle} right={right}>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" /><input className="h-9 w-64 rounded-md border border-gray-300 pl-8 pr-2 text-sm" placeholder="Search this register…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search register" /></div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        <span className="text-xs text-gray-500 ml-auto">{state.total} record(s)</span>
      </div>
      {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{columns.map(c => <th key={c.key} className="p-2 whitespace-nowrap font-medium">{c.label}</th>)}</tr></thead>
          <tbody>
            {state.rows.map((r, i) => <tr key={i} className="border-b last:border-0 hover:bg-gray-50/60">{columns.map(c => <td key={c.key} className={`p-2 align-top ${c.cls || ''}`}>{c.render ? c.render(r) : (r[c.key] ?? '')}</td>)}</tr>)}
            {!loading && !state.rows.length && <tr><td colSpan={columns.length} className="p-6 text-center text-gray-500">No records match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-sm">
          <button className="h-8 w-8 rounded border disabled:opacity-40 flex items-center justify-center" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-gray-600">Page {page} of {pages}</span>
          <button className="h-8 w-8 rounded border disabled:opacity-40 flex items-center justify-center" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </Section>
  );
}
