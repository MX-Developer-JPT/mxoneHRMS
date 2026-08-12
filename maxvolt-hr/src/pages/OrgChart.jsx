import React, { useState, useEffect, useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Network, Search, RefreshCw, ChevronDown, ChevronRight, Users, ArrowLeft, Home, Maximize2, ZoomIn, ZoomOut, Building2, Crown, FileSpreadsheet } from 'lucide-react';
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

  // A richly-styled, department-wise workbook: a Summary sheet with an
  // at-a-glance table of every department (head, headcount, depth), then one
  // sheet per department with its own indented reporting-line breakdown.
  // Always covers the whole company regardless of which view is currently
  // open — "department wise breakdown" is the point of the export, not a
  // snapshot of the one department the user happens to be looking at.
  const maxTreeDepth = (node, d = 1) => node.children.length ? Math.max(...node.children.map(c => maxTreeDepth(c, d + 1))) : d;

  const downloadExcel = async () => {
    if (!employees.length) return;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Maxvolt HR';
    wb.created = new Date();

    const ORANGE = 'FFE87722';
    const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
    const SUBHEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    const ROOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDEBD8' } };
    const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    const border = { style: 'thin', color: { argb: 'FFD1D5DB' } };
    const thinBorder = { top: border, bottom: border, left: border, right: border };

    // ── Summary sheet ──────────────────────────────────────────────────
    const summary = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
    summary.mergeCells('A1:E1');
    summary.getCell('A1').value = 'Maxvolt Energy Industries Limited — Organisation Structure';
    summary.getCell('A1').font = { bold: true, size: 15, color: { argb: ORANGE } };
    summary.getRow(1).height = 26;
    summary.mergeCells('A2:E2');
    summary.getCell('A2').value = `Exported ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} — ${employees.length} employees across ${deptGroups.length} departments`;
    summary.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };

    const headerRow = summary.getRow(4);
    headerRow.values = ['Department', 'Department Head', 'Headcount', 'Head\'s Direct Reports', 'Hierarchy Depth'];
    headerRow.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEADER_FILL; c.border = thinBorder; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
    headerRow.height = 20;

    deptGroups.forEach((g, i) => {
      const row = summary.addRow([
        g.dept, g.head?.name || '—', g.count,
        g.head?.children?.length || 0,
        Math.max(...g.roots.map(maxTreeDepth), 1),
      ]);
      row.eachCell(c => { c.border = thinBorder; c.alignment = { vertical: 'middle' }; if (i % 2 === 1) c.fill = ALT_FILL; });
    });
    summary.columns = [{ width: 28 }, { width: 28 }, { width: 12 }, { width: 20 }, { width: 16 }];

    // ── One sheet per department ───────────────────────────────────────
    const usedNames = new Set(['Summary']);
    deptGroups.forEach(g => {
      let sheetName = g.dept.replace(/[\[\]*/\\?:]/g, '').slice(0, 31) || 'Department';
      while (usedNames.has(sheetName)) sheetName = (sheetName.slice(0, 28) + '_' + (usedNames.size)).slice(0, 31);
      usedNames.add(sheetName);

      const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.mergeCells('A1:F1');
      const title = ws.getCell('A1');
      title.value = `${g.dept}  (${g.count} employee${g.count === 1 ? '' : 's'})`;
      title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      title.fill = HEADER_FILL;
      title.alignment = { vertical: 'middle', indent: 1 };
      ws.getRow(1).height = 24;
      ws.mergeCells('A2:F2');
      ws.getCell('A2').value = `Department Head: ${g.head?.name || '—'}${g.head?.designation ? ` (${g.head.designation})` : ''}`;
      ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };

      const hRow = ws.getRow(3);
      hRow.values = ['Level', 'Employee Name', 'Designation', 'Employee Code', 'Reports To', 'Team Size'];
      hRow.eachCell(c => { c.font = { bold: true }; c.fill = SUBHEAD_FILL; c.border = thinBorder; });

      const walk = (node, level, managerName) => {
        const row = ws.addRow([
          level + 1,
          '     '.repeat(level) + node.name,
          node.designation || '',
          node.employee_code || '',
          managerName || '—',
          countDescendants(node),
        ]);
        row.getCell(2).font = { bold: level === 0, size: level === 0 ? 12 : 10.5 };
        row.eachCell(c => { c.border = thinBorder; c.alignment = { vertical: 'middle' }; c.fill = level === 0 ? ROOT_FILL : (level % 2 === 0 ? ALT_FILL : undefined); });
        node.children.forEach(c => walk(c, level + 1, node.name));
      };
      g.roots.forEach(r => walk(r, 0, ''));
      ws.columns = [{ width: 8 }, { width: 40 }, { width: 26 }, { width: 16 }, { width: 28 }, { width: 12 }];
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `org-chart-department-breakdown-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
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
          <Button variant="outline" size="sm" onClick={downloadExcel} disabled={loading || employees.length === 0} title="Export the full department-wise org structure as a spreadsheet">
            <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Excel
          </Button>
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
                <ChartNode key={r.user_id} node={r} depth={0} collapsed={effectiveCollapsed} toggle={toggle} matchSet={matchSet} onFocus={focus} nodeRefs={nodeRefs} />
              ))}
            </div>
          </div>
        </ChartErrorBoundary>
      )}
    </div>
  );
}
