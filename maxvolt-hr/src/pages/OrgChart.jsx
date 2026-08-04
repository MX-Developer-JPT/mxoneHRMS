import React, { useState, useEffect, useMemo, useRef } from 'react';
// html2canvas-pro, not plain html2canvas — the original can't parse the
// `rgb(r g b / var(--tw-bg-opacity))` colour syntax Tailwind 3.4 emits for
// every utility class (bg-white, border colours, etc.), and silently
// renders anything it can't parse as solid black. That turned every card
// in the exported PDF into a black box. -pro is a maintained fork with
// modern CSS colour-function support (this exact case, oklch, color-mix).
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Network, Search, RefreshCw, ChevronDown, ChevronRight, Users, ArrowLeft, Home, Maximize2, ZoomIn, ZoomOut, Download, Loader2, Building2, Crown, FileSpreadsheet } from 'lucide-react';
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

function ChartCard({ node, highlight, hasKids, isCollapsed, onToggle, onFocus, cardRef, hidePhotos }) {
  return (
    <div
      ref={cardRef}
      className={`relative w-[168px] sm:w-[188px] bg-white dark:bg-[#1c1c1e] rounded-xl border border-t-4 shadow-sm hover:shadow-md transition-all cursor-pointer ${accentFor(node.department)} ${highlight ? 'ring-2 ring-violet-400' : ''}`}
      onClick={() => onFocus(node)}
      title={hasKids ? `View ${node.name}'s team` : node.name}
    >
      <div className="p-3 flex flex-col items-center text-center gap-1.5">
        {node.profile_picture_url && !hidePhotos ? (
          <img src={node.profile_picture_url} alt={node.name} className="w-12 h-12 rounded-full object-cover shadow" crossOrigin="anonymous" />
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
function ChartNode({ node, depth, collapsed, toggle, matchSet, onFocus, nodeRefs, isSibling, hidePhotos }) {
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
        hidePhotos={hidePhotos}
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
                <ChartNode node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} matchSet={matchSet} onFocus={onFocus} nodeRefs={nodeRefs} isSibling hidePhotos={hidePhotos} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Builds a reporting-manager tree from any subset of employees (the full
// roster, or just one department's members). A node's manager is only
// linked as its parent if the manager is ALSO in the given list — so a
// department-scoped call naturally roots the tree at whoever's manager
// falls outside the department, instead of pulling in people from other
// departments just to complete the chain up to a shared executive.
function buildOrgTree(employeeList) {
  const byId = {};
  employeeList.forEach(e => { byId[e.user_id] = { ...e, children: [] }; });
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
  employeeList.forEach(e => {
    const node = byId[e.user_id];
    const mgr = e.reporting_manager_id && byId[e.reporting_manager_id];
    if (mgr && e.reporting_manager_id !== e.user_id && !createsCycle(e.user_id, e.reporting_manager_id)) mgr.children.push(node);
    else { roots.push(node); if (e.reporting_manager_id) orphanCount++; }
  });
  const sortRec = (nodes) => { nodes.sort((a, b) => countDescendants(b) - countDescendants(a) || a.name.localeCompare(b.name)); nodes.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return { roots, orphanCount };
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
  // While exporting, profile photos are swapped for initials avatars —
  // html2canvas taints its whole output canvas the moment it touches a
  // cross-origin image with no CORS headers, which silently breaks the
  // PDF (addImage/toDataURL throws) for the entire org, not just the one
  // photo. Initials avatars are plain CSS, never a network image.
  const [pdfExportMode, setPdfExportMode] = useState(false);
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

  // The org-wide tree — used by "View Full Organisation" and by the PDF
  // export, which always exports everything regardless of which department
  // (if any) is currently being viewed.
  const { roots, orphanCount } = useMemo(() => buildOrgTree(employees), [employees]);

  // Department is the primary navigation: group employees by department,
  // build each one's own scoped tree (rooted at whoever's manager falls
  // outside that department), and surface a "head" card per department —
  // the root with the most reports, i.e. the most senior person visible
  // from inside that department's own hierarchy.
  const deptGroups = useMemo(() => {
    const byDept = {};
    employees.forEach(e => {
      const d = e.department || 'Unassigned';
      (byDept[d] ||= []).push(e);
    });
    return Object.entries(byDept).map(([dept, emps]) => {
      const { roots: deptRoots } = buildOrgTree(emps);
      const head = [...deptRoots].sort((a, b) => countDescendants(b) - countDescendants(a))[0] || emps[0];
      return { dept, count: emps.length, head, roots: deptRoots };
    }).sort((a, b) => b.count - a.count || a.dept.localeCompare(b.dept));
  }, [employees]);

  // null = browsing the department grid. '__ALL__' = full-org tree
  // (today's original whole-company view). Any other string = that
  // department's scoped tree.
  const [selectedDept, setSelectedDept] = useState(null);
  const activeGroup = selectedDept === '__ALL__' ? null : deptGroups.find(g => g.dept === selectedDept);
  const activeEmployees = selectedDept === '__ALL__' ? employees : (activeGroup ? employees.filter(e => (e.department || 'Unassigned') === selectedDept) : []);
  const activeRoots = selectedDept === '__ALL__' ? roots : (activeGroup ? activeGroup.roots : []);

  const openDept = (dept) => { setSelectedDept(dept); setCollapsed(new Set()); setFocusedId(null); setSearch(''); };
  const backToDepartments = () => { setSelectedDept(null); setCollapsed(new Set()); setFocusedId(null); setSearch(''); };

  const matchSet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !selectedDept) return new Set();
    return new Set(activeEmployees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) || (e.employee_code || '').toLowerCase().includes(q)
    ).map(e => e.user_id));
  }, [activeEmployees, search, selectedDept]);

  // Deck-selection change (entering a department, or switching to the full
  // org view): show roots + their direct reports only, collapse everyone
  // below that. A large tree fully expanded at once is unreadable — this
  // gives a top-down starting point to drill from.
  useEffect(() => {
    if (!activeRoots.length) return;
    const toCollapse = new Set();
    const walk = (node, depth) => {
      if (depth === 1) { toCollapse.add(node.user_id); return; }
      node.children.forEach(c => walk(c, depth + 1));
    };
    activeRoots.forEach(r => walk(r, 0));
    setCollapsed(toCollapse);
  }, [activeRoots]);

  const searchForcedOpen = useMemo(() => (matchSet.size ? collectAncestorIds(activeRoots, matchSet) : new Set()), [activeRoots, matchSet]);
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
  const focusResult = focusedId ? findNodeAndTrail(activeRoots, focusedId) : null;
  const displayRoots = focusResult ? [focusResult.node] : activeRoots;

  // Exports whichever tree is currently open — the full organisation, or a
  // single department — not just a drilled-down subteam even if one is
  // currently focused, as a multi-page landscape PDF tiled like a
  // poster/Gantt-chart printout rather than shrunk to fit one page, since a
  // large tree at readable card size is far wider/taller than A4.
  const downloadPdf = async () => {
    setDownloadingPdf(true);
    const prevCollapsed = collapsed, prevZoom = zoom, prevFocusedId = focusedId;
    setFocusedId(null);
    setCollapsed(new Set());
    setZoom(1);
    setPdfExportMode(true);
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 300)); // let a large (~250-node) expansion finish reflowing
      const el = chartRef.current;
      if (!el) throw new Error('Chart not ready');
      // No cross-origin <img> should remain once pdfExportMode swapped every
      // card to its initials avatar, but confirm rather than assume — a
      // leftover image is exactly what silently taints the whole canvas.
      const images = Array.from(el.querySelectorAll('img'));
      if (images.length) throw new Error(`${images.length} photo(s) still present — refresh and try again`);

      const isDark = document.documentElement.classList.contains('dark');
      const bg = isDark ? '#0b0b0d' : '#ffffff';

      // Capture each root's subtree as its own canvas rather than the whole
      // chartRef in one shot. A "Full Company" export with several dozen
      // orphaned/root-level employees (broken or missing manager links)
      // renders as that many separate trees side-by-side — a single capture
      // of the lot is easily tens of thousands of pixels wide. Real browsers
      // cap canvas dimensions (commonly ~16384px or ~268M px² total); past
      // that limit html2canvas returns a canvas that still *reports* the
      // requested width/height but whose pixels are blank, which silently
      // produced a many-page PDF of nothing rather than a visible error.
      // Capturing per-root keeps each canvas bounded by one manager's team.
      const MAX_CANVAS_AREA = 16000 * 16000;
      const rootEls = Array.from(el.children);
      if (!rootEls.length) throw new Error('Nothing to export');

      const TILE_W = 1600, TILE_H = 1000; // px per PDF page, landscape poster tiles
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [TILE_W, TILE_H] });
      const dateStr = new Date().toLocaleDateString('en-IN');
      const pdfTitle = selectedDept === '__ALL__' ? 'Organisation Chart — Full Company' : `Organisation Chart — ${selectedDept} Department`;

      // First pass: capture every root and count total tiles up front, so
      // the "page X of Y" footer is accurate without a second render pass.
      const captures = [];
      let skipped = 0;
      for (const rootEl of rootEls) {
        const canvas = await html2canvas(rootEl, { scale: 2, backgroundColor: bg, useCORS: true });
        if (canvas.width * canvas.height === 0) continue;
        if (canvas.width * canvas.height > MAX_CANVAS_AREA) { skipped++; continue; }
        captures.push(canvas);
      }
      if (!captures.length) throw new Error('Nothing captured — try a smaller view (a single department) instead of the full company');

      const totalPages = captures.reduce((sum, c) => sum + Math.ceil(c.width / TILE_W) * Math.ceil(c.height / TILE_H), 0);

      let page = 0;
      for (const canvas of captures) {
        const cols = Math.ceil(canvas.width / TILE_W);
        const rows = Math.ceil(canvas.height / TILE_H);
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
            // JPEG, not PNG — a full-company export can be 100+ pages, and
            // PNG's lossless encoding of a mostly-flat-colour chart made the
            // file hundreds of MB. Quality 0.85 is visually lossless here.
            pdf.addImage(tile.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, TILE_W, TILE_H);
            pdf.setFontSize(10);
            pdf.setTextColor(isDark ? 200 : 90);
            pdf.text(`${pdfTitle} — generated ${dateStr} — page ${page + 1} of ${totalPages}`, 12, TILE_H - 10);
            page++;
          }
        }
      }
      if (skipped > 0) toast.warning(`${skipped} team(s) were too large to render and were left out of the PDF — try exporting that department separately.`);
      const fileLabel = selectedDept === '__ALL__' ? 'full-company' : (selectedDept || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      pdf.save(`org-chart-${fileLabel}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast.error('Failed to generate PDF: ' + e.message);
    } finally {
      setCollapsed(prevCollapsed);
      setZoom(prevZoom);
      setFocusedId(prevFocusedId);
      setPdfExportMode(false);
      setDownloadingPdf(false);
    }
  };

  // A plain tabular export of whichever view is open — doesn't depend on
  // html2canvas/browser rendering at all, so it's a reliable fallback
  // regardless of how large or unusually-shaped the visual chart is.
  const downloadExcel = () => {
    if (!activeRoots.length) return;
    const rows = [];
    const walk = (node, level, managerName) => {
      rows.push({
        Level: level + 1,
        'Employee Name': '  '.repeat(level) + node.name,
        Designation: node.designation || '',
        Department: node.department || '',
        'Employee Code': node.employee_code || '',
        'Reports To': managerName || '',
        'Team Size': countDescendants(node),
      });
      node.children.forEach(c => walk(c, level + 1, node.name));
    };
    activeRoots.forEach(r => walk(r, 0, ''));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 7 }, { wch: 34 }, { wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    const sheetTitle = selectedDept === '__ALL__' ? 'Full Company' : selectedDept;
    XLSX.utils.book_append_sheet(wb, ws, sheetTitle.slice(0, 31));
    const fileLabel = selectedDept === '__ALL__' ? 'full-company' : (selectedDept || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    XLSX.writeFile(wb, `org-chart-${fileLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const deptSearch = selectedDept ? '' : search.trim().toLowerCase();
  const visibleDeptGroups = deptSearch
    ? deptGroups.filter(g => g.dept.toLowerCase().includes(deptSearch))
    : deptGroups;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-violet-600" />
            {selectedDept === null ? 'Organisation Chart' : selectedDept === '__ALL__' ? 'Organisation Chart — Full Company' : `${selectedDept} Department`}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {selectedDept === null
              ? `${employees.length} active employees across ${deptGroups.length} department${deptGroups.length === 1 ? '' : 's'} — pick a department to see its hierarchy`
              : `${activeEmployees.length} employees · reporting hierarchy${orphanCount > 0 && selectedDept === '__ALL__' ? ` · ${orphanCount} with a manager not in the system (shown at top level)` : ''}`}
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-56" placeholder={selectedDept ? 'Search name, role…' : 'Search department…'} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {selectedDept !== null && (
            <>
              <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}><Maximize2 className="w-4 h-4 mr-1" /> Expand All</Button>
              <div className="flex items-center border rounded-md">
                <Button variant="ghost" size="sm" className="h-8 px-2 rounded-r-none" onClick={zoomOut} disabled={zoom <= 0.4} title="Zoom out"><ZoomOut className="w-4 h-4" /></Button>
                <button onClick={zoomReset} className="text-xs w-11 text-center text-gray-500 dark:text-gray-400 hover:text-violet-600" title="Reset zoom">{Math.round(zoom * 100)}%</button>
                <Button variant="ghost" size="sm" className="h-8 px-2 rounded-l-none" onClick={zoomIn} disabled={zoom >= 1.5} title="Zoom in"><ZoomIn className="w-4 h-4" /></Button>
              </div>
            </>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
          {selectedDept !== null && (
            <>
              <Button variant="outline" size="sm" onClick={downloadPdf} disabled={downloadingPdf || loading || activeRoots.length === 0} title="Download this chart as a multi-page PDF">
                {downloadingPdf ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                {downloadingPdf ? 'Generating…' : 'Download PDF'}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadExcel} disabled={loading || activeRoots.length === 0} title="Export this hierarchy as a spreadsheet — a plain-text fallback that always renders correctly">
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Excel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Breadcrumb: Departments › [Dept] › drilled-down person trail */}
      {selectedDept !== null && (
        <div className="flex items-center gap-1.5 flex-wrap text-sm bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 rounded-lg px-3 py-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40" onClick={backToDepartments}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Departments
          </Button>
          <button onClick={() => setFocusedId(null)} className="flex items-center gap-1 text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 shrink-0">
            <Home className="w-3.5 h-3.5" /> {selectedDept === '__ALL__' ? 'Full company' : selectedDept}
          </button>
          {focusResult && focusResult.trail.map(t => (
            <React.Fragment key={t.user_id}>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              <button onClick={() => setFocusedId(t.user_id)} className="text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 truncate max-w-[140px]">{t.name}</button>
            </React.Fragment>
          ))}
          {focusResult && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              <span className="font-semibold text-violet-800 dark:text-violet-200 truncate max-w-[160px]">{focusResult.node.name}</span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : selectedDept === null ? (
        deptGroups.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Network className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            No employees found. Set reporting managers on employee records to build the chart.
          </div>
        ) : (
          <div className="space-y-4">
            <button onClick={() => openDept('__ALL__')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/60 dark:hover:bg-violet-900/30 transition-colors text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-300">
                <Network className="w-4 h-4" /> View entire company hierarchy (all departments together)
              </span>
              <ChevronRight className="w-4 h-4 text-violet-400" />
            </button>

            {visibleDeptGroups.length === 0 ? (
              <p className="text-center text-gray-400 py-10">No departments match "{search}"</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {visibleDeptGroups.map(g => (
                  <button key={g.dept} onClick={() => openDept(g.dept)}
                    className={`relative text-left bg-white dark:bg-[#1c1c1e] rounded-xl border border-t-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-4 ${accentFor(g.dept)}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        <Building2 className="w-3.5 h-3.5" /> Department
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-gray-500">
                        <Users className="w-2.5 h-2.5 mr-0.5" />{g.count}
                      </Badge>
                    </div>
                    <p className="font-semibold text-gray-800 dark:text-gray-100 text-base mb-3">{g.dept}</p>
                    {g.head && (
                      <div className="flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                        {g.head.profile_picture_url ? (
                          <img src={g.head.profile_picture_url} alt={g.head.name} className="w-8 h-8 rounded-full object-cover shadow" />
                        ) : (
                          <div className={`w-8 h-8 rounded-full ${colorFor(g.head.name)} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
                            {initials(g.head.name)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate flex items-center gap-1">
                            <Crown className="w-3 h-3 text-amber-500 shrink-0" /> {g.head.name}
                          </p>
                          <p className="text-[11px] text-gray-400 truncate">{g.head.designation || 'Department Head'}</p>
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      ) : activeRoots.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Network className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          No employees found in this view.
        </div>
      ) : (
        <ChartErrorBoundary key={`${selectedDept}:${displayRoots.map(r => r.user_id).join(',')}`}>
          <div className="overflow-auto pb-8 pt-2 max-h-[75vh]" onWheel={handleWheel}>
            <div ref={chartRef} className="min-w-max flex justify-center gap-10" style={{ zoom }}>
              {displayRoots.map(r => (
                <ChartNode key={r.user_id} node={r} depth={0} collapsed={effectiveCollapsed} toggle={toggle} matchSet={matchSet} onFocus={focus} nodeRefs={nodeRefs} hidePhotos={pdfExportMode} />
              ))}
            </div>
          </div>
        </ChartErrorBoundary>
      )}
    </div>
  );
}
