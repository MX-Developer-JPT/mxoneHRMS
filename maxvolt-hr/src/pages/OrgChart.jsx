import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Network, Search, RefreshCw, ChevronDown, ChevronRight, Users, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';

const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500'];
const colorFor = (name) => AVATAR_COLORS[(name || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = (name) => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function NodeCard({ node, highlight }) {
  return (
    <div className={`inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border bg-white shadow-sm transition-all ${highlight ? 'border-violet-400 ring-2 ring-violet-200' : 'border-gray-200'}`}>
      <div className={`w-9 h-9 rounded-full ${colorFor(node.name)} text-white flex items-center justify-center text-xs font-bold shrink-0`}>
        {initials(node.name)}
      </div>
      <div className="text-left min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate max-w-[160px]">{node.name}</p>
        <p className="text-[11px] text-gray-500 truncate max-w-[160px]">{node.designation || node.department || node.employee_code}</p>
      </div>
    </div>
  );
}

function TreeNode({ node, depth, collapsed, toggle, matchSet }) {
  const hasKids = node.children.length > 0;
  const isCollapsed = collapsed.has(node.user_id);
  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 28 }}>
        {hasKids ? (
          <button onClick={() => toggle(node.user_id)} className="p-0.5 rounded hover:bg-gray-100 text-gray-400 shrink-0">
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        ) : <span className="w-5 shrink-0" />}
        <NodeCard node={node} highlight={matchSet.has(node.user_id)} />
        {hasKids && (
          <Badge variant="outline" className="text-[10px] text-gray-400 shrink-0">
            <Users className="w-3 h-3 mr-1" />{countDescendants(node)}
          </Badge>
        )}
      </div>
      {!isCollapsed && hasKids && (
        <div className="mt-2 space-y-2 border-l border-gray-200 ml-[9px]">
          {node.children.map(c => (
            <TreeNode key={c.user_id} node={c} depth={depth + 1} collapsed={collapsed} toggle={toggle} matchSet={matchSet} />
          ))}
        </div>
      )}
    </div>
  );
}

function countDescendants(node) {
  return node.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
}

export default function OrgChart() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(new Set());

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

  const { roots, matchSet, orphanCount } = useMemo(() => {
    const byId = {};
    employees.forEach(e => { byId[e.user_id] = { ...e, children: [] }; });
    const roots = [];
    let orphanCount = 0;
    employees.forEach(e => {
      const node = byId[e.user_id];
      const mgr = e.reporting_manager_id && byId[e.reporting_manager_id];
      if (mgr && e.reporting_manager_id !== e.user_id) mgr.children.push(node);
      else { roots.push(node); if (e.reporting_manager_id) orphanCount++; }
    });
    // Sort: biggest teams first, then alphabetical
    const sortRec = (nodes) => { nodes.sort((a, b) => countDescendants(b) - countDescendants(a) || a.name.localeCompare(b.name)); nodes.forEach(n => sortRec(n.children)); };
    sortRec(roots);
    const q = search.trim().toLowerCase();
    const matchSet = new Set(q ? employees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) || (e.employee_code || '').toLowerCase().includes(q)
    ).map(e => e.user_id) : []);
    return { roots, matchSet, orphanCount };
  }, [employees, search]);

  const toggle = (id) => setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const collapseAll = () => {
    const ids = new Set();
    const walk = (n) => { if (n.children.length) { ids.add(n.user_id); n.children.forEach(walk); } };
    roots.forEach(r => r.children.forEach(walk)); // keep top level open
    setCollapsed(ids);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Network className="w-6 h-6 text-violet-600" /> Organisation Chart
          </h1>
          <p className="text-gray-500 text-sm mt-1">{employees.length} active employees · reporting hierarchy from employee records{orphanCount > 0 ? ` · ${orphanCount} with a manager not in the system (shown at top level)` : ''}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 w-56" placeholder="Search name, role, dept…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={collapseAll}><Minus className="w-4 h-4 mr-1" /> Collapse</Button>
          <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}><Plus className="w-4 h-4 mr-1" /> Expand</Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : roots.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Network className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          No employees found. Set reporting managers on employee records to build the chart.
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="min-w-[320px] space-y-4">
            {roots.map(r => (
              <TreeNode key={r.user_id} node={r} depth={0} collapsed={collapsed} toggle={toggle} matchSet={matchSet} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
