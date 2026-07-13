import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Network, Search, RefreshCw, ChevronDown, ChevronRight, Users, ArrowLeft, Home, Maximize2, ZoomIn, ZoomOut, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500'];
const colorFor = (name) => AVATAR_COLORS[(name || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (name) => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function countDescendants(node) {
  return node.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
}

// Walks the tree collecting the ancestor chain (root → ... → parent) for
// every node whose id is in `targetIds` — used so a search match is never
// left invisible inside a collapsed ancestor.
function collectAncestorIds(roots, targetIds) {
  const ancestors = new Set();
  const walk = (node, trail) => {
    if (targetIds.has(node.user_id)) trail.forEach(id => ancestors.add(id));
    node.children.forEach(c => walk(c, [...trail, node.user_id]));
  };
  roots.forEach(r => walk(r, []));
  return ancestors;
}

function findNodeAndTrail(roots, id) {
  let result = null;
  const walk = (node, trail) => {
    if (result) return;
    if (node.user_id === id) { result = { node, trail }; return; }
    node.children.forEach(c => walk(c, [...trail, node]));
  };
  roots.forEach(r => walk(r, []));
  return result;
}

const DEPT_ACCENTS = {}; // colour cache so the same department always gets the same accent
const ACCENT_PALETTE = ['border-t-blue-400', 'border-t-violet-400', 'border-t-emerald-400', 'border-t-orange-400', 'border-t-pink-400', 'border-t-teal-400', 'border-t-indigo-400', 'border-t-rose-400'];
function accentFor(dept) {
  if (!dept) return 'border-t-gray-300';
  if (!DEPT_ACCENTS[dept]) DEPT_ACCENTS[dept] = ACCENT_PALETTE[Object.keys(DEPT_ACCENTS).length % ACCENT_PALETTE.length];
  return DEPT_ACCENTS[dept];
}

function ChartCard({ node, highlight, hasKids, isCollapsed, onToggle, onFocus, cardRef }) {
  return (
    <div
      ref={cardRef}
      className={`relative w-[168px] sm:w-[188px] bg-white dark:bg-[#1c1c1e] rounded-xl border border-t-4 shadow-sm hover:shadow-md transition-all cursor-pointer ${accentFor(node.department)} ${highlight ? 'ring-2 ring-violet-400' : ''}`}
      onClick={() => onFocus(node)}
      title={hasKids ? `View ${node.name}'s team` : node.name}
    >
      <div className="p-3 flex flex-col items-center text-center gap-1.5">
        {node.profile_picture_url ? (
          <img src={node.profile_picture_url} alt={node.name} className="w-12 h-12 rounded-full object-cover shadow" />
        ) : (
          <div className={`w-12 h-12 rounded-full ${colorFor(node.name)} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
            {initials(node.name)}
          </div>
        )}
        <div className="min-w-0 w-full">
          <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 truncate">{node.name}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{node.designation || node.department || 'No title'}</p>
          {node.employee_code && <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{node.employee_code}</p>}
        </div>
      </div>
      {hasKids && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(node.user_id); }}
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-gray-500 hover:text-violet-600 hover:border-violet-300"
          title={isCollapsed ? 'Expand team' : 'Collapse team'}
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      )}
      {hasKids && (
        <Badge variant="outline" className="absolute -top-2 -right-2 text-[10px] px-1.5 py-0 h-5 bg-white dark:bg-[#1c1c1e] text-gray-500 shadow-sm">
          <Users className="w-2.5 h-2.5 mr-0.5" />{countDescendants(node)}
        </Badge>
      )}
    </div>
  );
}

// Real connected-box chart: a vertical stem drops from the parent card, a
// horizontal bar spans the children row, and each child gets its own stem up
// to that bar — built with two half-width border segments per child (left
// half connects to the previous sibling, right half to the next) so no
// background-colour-matching hacks are needed for light/dark mode.
function ChartNode({ node, depth, collapsed, toggle, matchSet, onFocus, nodeRefs, isSibling }) {
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(node.user_id);
  const isMatch = matchSet.has(node.user_id);

  return (
    <div className="flex flex-col items-center">
      <ChartCard
        node={node}
        highlight={isMatch}
        hasKids={hasKids}
        isCollapsed={isCollapsed}
        onToggle={toggle}
        onFocus={onFocus}
        cardRef={isMatch ? (el) => { if (el) nodeRefs.current[node.user_id] = el; } : undefined}
      />
      {hasKids && !isCollapsed && (
        <>
          <div className="w-0.5 h-6 bg-gray-300 dark:bg-gray-600" />
          <div className="flex">
            {node.children.map((child, i) => (
              <div key={child.user_id} className="relative px-4 pt-6">
                {i > 0 && <div className="absolute top-0 left-0 w-1/2 h-0.5 bg-gray-300 dark:bg-gray-600" />}
                {i < node.children.length - 1 && <div className="absolute top-0 right-0 w-1/2 h-0.5 bg-gray-300 dark:bg-gray-600" />}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-6 bg-gray-300 dark:bg-gray-600" />
                <ChartNode node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} matchSet={matchSet} onFocus={onFocus} nodeRefs={nodeRefs} isSibling />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

class ChartErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="text-center py-16 text-gray-400">
          <Network className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          Couldn't render the chart ({this.state.error.message || 'unknown error'}). Try Refresh above.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function OrgChart() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());
  const [focusedId, setFocusedId] = useState(null); // drill-down: view just this person's team
  const [zoom, setZoom] = useState(1);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const nodeRefs = useRef({});
  const chartRef = useRef(null);

  const zoomIn = () => setZoom(z => Math.min(1.5, Math.round((z + 0.1) * 10) / 10));
  const zoomOut = () => setZoom(z => Math.max(0.4, Math.round((z - 0.1) * 10) / 10));
  const zoomReset = () => setZoom(1);
  // Ctrl/Cmd + wheel (mouse) and pinch (trackpad, which browsers report as a
  // ctrlKey wheel event) zoom the chart instead of scrolling the page.
  const handleWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  };

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getOrgChart', {});
      const d = res.data || res;
      if (d.success) setEmployees(d.employees || []);
      else toast.error(d.error || 'Failed to load org chart');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const { roots, orphanCount } = useMemo(() => {
    const byId = {};
    employees.forEach(e => { byId[e.user_id] = { ...e, children: [] }; });
    // Detects whether attaching `id` under `mgrId` would create a cycle in the
    // reporting chain (e.g. corrupted/imported data where A reports to B who,
    // through some chain, reports back to A). Without this check such a cycle
    // makes the recursive tree walks below (countDescendants, sortRec) recurse
    // forever and silently crash the chart's render.
    //
    // Only a chain that loops back to `id` itself disqualifies this edge. A
    // cycle further up the chain that never reaches `id` is unrelated to this
    // employee — real orgs commonly funnel many people through the same
    // senior chain, so `seen` re-triggering there must NOT disqualify every
    // employee downstream of it (that previously mass-orphaned ~150 people
    // whose chain merely passed near one unrelated bad edge).
    const createsCycle = (id, mgrId) => {
      let cur = byId[mgrId];
      const seen = new Set();
      while (cur) {
        if (cur.user_id === id) return true;
        if (seen.has(cur.user_id)) return false; // unrelated cycle further up — safe to attach here
        seen.add(cur.user_id);
        cur = cur.reporting_manager_id ? byId[cur.reporting_manager_id] : null;
      }
      return false;
    };
    const roots = [];
    let orphanCount = 0;
    employees.forEach(e => {
      const node = byId[e.user_id];
      const mgr = e.reporting_manager_id && byId[e.reporting_manager_id];
      if (mgr && e.reporting_manager_id !== e.user_id && !createsCycle(e.user_id, e.reporting_manager_id)) mgr.children.push(node);
      else { roots.push(node); if (e.reporting_manager_id) orphanCount++; }
    });
    const sortRec = (nodes) => { nodes.sort((a, b) => countDescendants(b) - countDescendants(a) || a.name.localeCompare(b.name)); nodes.forEach(n => sortRec(n.children)); };
    sortRec(roots);
    return { roots, orphanCount };
  }, [employees]);

  const matchSet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set();
    return new Set(employees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) || (e.employee_code || '').toLowerCase().includes(q)
    ).map(e => e.user_id));
  }, [employees, search]);

  // First render of a freshly-loaded tree: show roots + their direct reports
  // only, collapse everyone below that. A ~250-person org fully expanded at
  // once is unreadable — this gives a top-down starting point to drill from.
  useEffect(() => {
    if (!roots.length) return;
    const toCollapse = new Set();
    const walk = (node, depth) => {
      if (depth === 1) { toCollapse.add(node.user_id); return; }
      node.children.forEach(c => walk(c, depth + 1));
    };
    roots.forEach(r => walk(r, 0));
    setCollapsed(toCollapse);
  }, [roots]);

  const searchForcedOpen = useMemo(() => (matchSet.size ? collectAncestorIds(roots, matchSet) : new Set()), [roots, matchSet]);
  const effectiveCollapsed = useMemo(() => {
    if (!searchForcedOpen.size) return collapsed;
    const next = new Set(collapsed);
    searchForcedOpen.forEach(id => next.delete(id));
    return next;
  }, [collapsed, searchForcedOpen]);

  useEffect(() => {
    if (!matchSet.size) return;
    const firstId = [...matchSet][0];
    const el = nodeRefs.current[firstId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [matchSet, effectiveCollapsed]);

  const toggle = (id) => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const focus = (node) => { if (node.children.length) setFocusedId(node.user_id); };
  const focusResult = focusedId ? findNodeAndTrail(roots, focusedId) : null;
  const displayRoots = focusResult ? [focusResult.node] : roots;

  // Exports the full org chart (not just a drilled-down subteam, even if
  // one is currently focused) as a multi-page landscape PDF — tiled like a
  // poster/Gantt-chart printout rather than shrunk to fit one page, since a
  // ~250-person tree at readable card size is far wider/taller than A4.
  const downloadPdf = async () => {
    setDownloadingPdf(true);
    const prevCollapsed = collapsed, prevZoom = zoom, prevFocusedId = focusedId;
    setFocusedId(null);
    setCollapsed(new Set());
    setZoom(1);
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 300)); // let a large (~250-node) expansion finish reflowing
      const el = chartRef.current;
      if (!el) throw new Error('Chart not ready');
      const images = Array.from(el.querySelectorAll('img'));
      await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const isDark = document.documentElement.classList.contains('dark');
      const bg = isDark ? '#0b0b0d' : '#ffffff';
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: bg, useCORS: true });

      const TILE_W = 1600, TILE_H = 1000; // px per PDF page, landscape poster tiles
      const cols = Math.ceil(canvas.width / TILE_W);
      const rows = Math.ceil(canvas.height / TILE_H);
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [TILE_W, TILE_H] });
      const dateStr = new Date().toLocaleDateString('en-IN');
      let page = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = c * TILE_W, sy = r * TILE_H;
          const sw = Math.min(TILE_W, canvas.width - sx);
          const sh = Math.min(TILE_H, canvas.height - sy);
          const tile = document.createElement('canvas');
          tile.width = TILE_W; tile.height = TILE_H;
          const tctx = tile.getContext('2d');
          tctx.fillStyle = bg; tctx.fillRect(0, 0, TILE_W, TILE_H);
          tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          if (page > 0) pdf.addPage([TILE_W, TILE_H], 'landscape');
          pdf.addImage(tile.toDataURL('image/png'), 'PNG', 0, 0, TILE_W, TILE_H);
          pdf.setFontSize(10);
          pdf.setTextColor(isDark ? 200 : 90);
          pdf.text(`Organisation Chart — generated ${dateStr} — page ${page + 1} of ${rows * cols}`, 12, TILE_H - 10);
          page++;
        }
      }
      pdf.save(`org-chart-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast.error('Failed to generate PDF: ' + e.message);
    } finally {
      setCollapsed(prevCollapsed);
      setZoom(prevZoom);
      setFocusedId(prevFocusedId);
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-violet-600" /> Organisation Chart
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{employees.length} active employees · reporting hierarchy from employee records{orphanCount > 0 ? ` · ${orphanCount} with a manager not in the system (shown at top level)` : ''}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-56" placeholder="Search name, role, dept…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}><Maximize2 className="w-4 h-4 mr-1" /> Expand All</Button>
          <div className="flex items-center border rounded-md">
            <Button variant="ghost" size="sm" className="h-8 px-2 rounded-r-none" onClick={zoomOut} disabled={zoom <= 0.4} title="Zoom out"><ZoomOut className="w-4 h-4" /></Button>
            <button onClick={zoomReset} className="text-xs w-11 text-center text-gray-500 dark:text-gray-400 hover:text-violet-600" title="Reset zoom">{Math.round(zoom * 100)}%</button>
            <Button variant="ghost" size="sm" className="h-8 px-2 rounded-l-none" onClick={zoomIn} disabled={zoom >= 1.5} title="Zoom in"><ZoomIn className="w-4 h-4" /></Button>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={downloadingPdf || loading || roots.length === 0} title="Download the full chart as a multi-page PDF">
            {downloadingPdf ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            {downloadingPdf ? 'Generating…' : 'Download PDF'}
          </Button>
        </div>
      </div>

      {focusResult && (
        <div className="flex items-center gap-1.5 flex-wrap text-sm bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 rounded-lg px-3 py-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40" onClick={() => setFocusedId(null)}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
          </Button>
          <button onClick={() => setFocusedId(null)} className="flex items-center gap-1 text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 shrink-0">
            <Home className="w-3.5 h-3.5" /> Full org
          </button>
          {focusResult.trail.map(t => (
            <React.Fragment key={t.user_id}>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              <button onClick={() => setFocusedId(t.user_id)} className="text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 truncate max-w-[140px]">{t.name}</button>
            </React.Fragment>
          ))}
          <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
          <span className="font-semibold text-violet-800 dark:text-violet-200 truncate max-w-[160px]">{focusResult.node.name}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : roots.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Network className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          No employees found. Set reporting managers on employee records to build the chart.
        </div>
      ) : (
        <ChartErrorBoundary key={displayRoots.map(r => r.user_id).join(',')}>
          <div className="overflow-auto pb-8 pt-2 max-h-[75vh]" onWheel={handleWheel}>
            <div ref={chartRef} className="min-w-max flex justify-center gap-10" style={{ zoom }}>
              {displayRoots.map(r => (
                <ChartNode key={r.user_id} node={r} depth={0} collapsed={effectiveCollapsed} toggle={toggle} matchSet={matchSet} onFocus={focus} nodeRefs={nodeRefs} />
              ))}
            </div>
          </div>
        </ChartErrorBoundary>
      )}
    </div>
  );
}
