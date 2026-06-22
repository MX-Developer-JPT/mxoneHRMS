import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Database, Users, RefreshCw, Trash2, Edit, Plus, Search,
  ChevronLeft, ChevronRight, Eye, Key, AlertTriangle, X, Check,
  BarChart3, Table2, UserCog, Shield, Mail, Send, CheckCircle2, XCircle, Loader2,
  Bot, Sparkles, ExternalLink, Zap, Fingerprint, Copy, RotateCcw, Globe, Code2,
  ScrollText, Clock, Download, Settings2
} from 'lucide-react';
import { toast } from 'sonner';

const TOKEN_KEY = 'base44_access_token';
const API = (path) => `/api/admin${path}`;

async function adminFetch(path, opts = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API(path), { ...opts, headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

// ── JSON editor modal ──────────────────────────────────────
function JsonEditorModal({ title, data, onSave, onClose, isNew = false }) {
  const [text, setText] = useState(JSON.stringify(data || {}, null, 2));
  const [error, setError] = useState('');

  const handleSave = () => {
    try {
      const parsed = JSON.parse(text);
      onSave(parsed);
    } catch {
      setError('Invalid JSON — fix syntax errors before saving.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-foreground" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {error && <p className="text-destructive text-xs mb-2">{error}</p>}
          <textarea
            className="w-full h-96 font-mono text-xs bg-muted/40 border rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            value={text}
            onChange={e => { setText(e.target.value); setError(''); }}
            spellCheck={false}
          />
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>
            <Check className="w-4 h-4 mr-1" /> {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm dialog ─────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-2xl p-6 max-w-sm mx-4 text-center">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <p className="text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

// ── Stats cards ────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
        { label: 'Total Users',    value: stats.users,    icon: Users,    color: 'text-blue-600' },
        { label: 'Total Records',  value: stats.entities, icon: Database, color: 'text-indigo-600' },
        { label: 'Entity Types',   value: stats.by_type?.length || 0, icon: Table2, color: 'text-purple-600' },
      ].map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="bg-card border rounded-xl p-4 flex items-center gap-3">
          <Icon className={`w-8 h-8 ${color}`} />
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── CSV export helper ──────────────────────────────────────
function exportUsersCSV(users) {
  const header = ['Name', 'Email', 'Role', 'Joined'];
  const rows = users.map(u => [
    (u.full_name || '').replace(/,/g, ' '),
    u.email || '',
    u.role || '',
    u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '',
  ]);
  const csv = '﻿' + [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `users_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}

// ── User management tab ────────────────────────────────────
const ROLES = [
  { value: 'admin',              label: 'Admin',              color: 'bg-red-100 text-red-800' },
  { value: 'hr',                 label: 'HR',                 color: 'bg-purple-100 text-purple-800' },
  { value: 'manager',            label: 'Manager',            color: 'bg-orange-100 text-orange-800' },
  { value: 'employee',           label: 'Employee',           color: 'bg-blue-100 text-blue-800' },
  { value: 'management',         label: 'Management',         color: 'bg-teal-100 text-teal-800' },
  { value: 'gate_admin',         label: 'Gate Admin',         color: 'bg-green-100 text-green-800' },
  { value: 'onboarding_pending', label: 'Onboarding Pending', color: 'bg-gray-100 text-gray-700' },
];
const roleColor = (role) => ROLES.find(r => r.value === role)?.color || 'bg-gray-100 text-gray-700';

function UserFormModal({ title, initial, onSave, onClose, isNew }) {
  const [form, setForm] = useState({
    full_name: initial?.full_name || '',
    email: initial?.email || '',
    role: initial?.role || 'employee',
    password: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.email) return toast.error('Email is required');
    if (isNew && form.password.length < 6) return toast.error('Password must be at least 6 characters');
    const payload = { full_name: form.full_name, email: form.email, role: form.role };
    if (isNew) payload.password = form.password;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{title}</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-sm font-medium">Full Name</Label>
            <Input className="mt-1" placeholder="e.g. Jai Pratap Tyagi" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
          <div>
            <Label className="text-sm font-medium">Email <span className="text-red-500">*</span></Label>
            <Input className="mt-1" type="email" placeholder="user@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <Label className="text-sm font-medium">Role <span className="text-red-500">*</span></Label>
            <select
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background focus:ring-2 ring-primary outline-none"
              value={form.role}
              onChange={e => set('role', e.target.value)}
            >
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {isNew && (
            <div>
              <Label className="text-sm font-medium">Password <span className="text-red-500">*</span></Label>
              <Input className="mt-1" type="password" placeholder="Min 6 characters" value={form.password} onChange={e => set('password', e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit}>{isNew ? 'Create User' : 'Save Changes'}</Button>
        </div>
      </div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [editUser, setEditUser]     = useState(null);
  const [newUserForm, setNewUserForm] = useState(false);
  const [pwdModal, setPwdModal]       = useState(null);
  const [confirm, setConfirm]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await adminFetch('/users')); }
    catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u =>
    search ? (u.email + u.full_name + u.role).toLowerCase().includes(search.toLowerCase()) : true
  );

  const handleSaveEdit = async (data) => {
    try {
      await adminFetch(`/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(data) });
      toast.success('User updated'); setEditUser(null); load();
    } catch(e) { toast.error(e.message); }
  };

  const handleCreate = async (data) => {
    try {
      await adminFetch('/users', { method: 'POST', body: JSON.stringify(data) });
      toast.success('User created'); setNewUserForm(false); load();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    try {
      await adminFetch(`/users/${id}`, { method: 'DELETE' });
      toast.success('User deleted'); setConfirm(null); load();
    } catch(e) { toast.error(e.message); }
  };

  const handlePasswordReset = async ({ id, password }) => {
    try {
      await adminFetch(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
      toast.success('Password updated'); setPwdModal(null);
    } catch(e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search users…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportUsersCSV(users)}>
            <Download className="w-4 h-4 mr-1" /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setNewUserForm(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add User
          </Button>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground p-4">Loading…</p> : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{['Name','Email','Role','Joined','Actions'].map(h=><th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{u.full_name || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColor(u.role)}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditUser(u)} title="Edit user">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPwdModal(u)} title="Reset password">
                        <Key className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setConfirm(u)} title="Delete user">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editUser && (
        <UserFormModal title={`Edit User — ${editUser.email}`} initial={editUser} onSave={handleSaveEdit} onClose={() => setEditUser(null)} />
      )}
      {newUserForm && (
        <UserFormModal title="Create New User" isNew onSave={handleCreate} onClose={() => setNewUserForm(false)} />
      )}
      {pwdModal && <PasswordModal user={pwdModal} onSave={handlePasswordReset} onClose={() => setPwdModal(null)} />}
      {confirm && <ConfirmDialog message={`Delete user "${confirm.email}"? This cannot be undone.`} onConfirm={() => handleDelete(confirm.id)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

function PasswordModal({ user, onSave, onClose }) {
  const [pwd, setPwd] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h3 className="font-semibold mb-1">Reset Password</h3>
        <p className="text-sm text-muted-foreground mb-4">{user.email}</p>
        <Input type="password" placeholder="New password (min 6 chars)" value={pwd} onChange={e=>setPwd(e.target.value)} className="mb-4" />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={pwd.length<6} onClick={() => onSave({ id:user.id, password:pwd })}>Save</Button>
        </div>
      </div>
    </div>
  );
}

// ── Entity browser tab ─────────────────────────────────────
function EntitiesTab({ typeCounts }) {
  const [selectedType, setSelectedType]   = useState('');
  const [records, setRecords]             = useState([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [pages, setPages]                 = useState(1);
  const [loading, setLoading]             = useState(false);
  const [search, setSearch]               = useState('');
  const [editRecord, setEditRecord]       = useState(null);
  const [newRecord, setNewRecord]         = useState(null);
  const [viewRecord, setViewRecord]       = useState(null);
  const [confirm, setConfirm]             = useState(null);
  const [selected, setSelected]           = useState(new Set());

  const loadRecords = useCallback(async (type = selectedType, pg = page, q = search) => {
    if (!type) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: 20, ...(q ? { search: q } : {}) });
      const data   = await adminFetch(`/entities/${type}?${params}`);
      setRecords(data.data);
      setTotal(data.total);
      setPages(data.pages);
      setSelected(new Set());
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [selectedType, page, search]);

  const selectType = (type) => {
    setSelectedType(type); setPage(1); setSearch('');
    loadRecords(type, 1, '');
  };

  const handleSaveEdit = async (data) => {
    try {
      await adminFetch(`/entities/${selectedType}/${editRecord.id}`, { method: 'PUT', body: JSON.stringify(data) });
      toast.success('Record updated'); setEditRecord(null); loadRecords();
    } catch(e) { toast.error(e.message); }
  };

  const handleCreate = async (data) => {
    try {
      await adminFetch(`/entities/${selectedType}`, { method: 'POST', body: JSON.stringify(data) });
      toast.success('Record created'); setNewRecord(null); loadRecords();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    try {
      await adminFetch(`/entities/${selectedType}/${id}`, { method: 'DELETE' });
      toast.success('Record deleted'); setConfirm(null); loadRecords();
    } catch(e) { toast.error(e.message); }
  };

  const handleBulkDelete = async () => {
    if (!selected.size) return;
    try {
      await adminFetch(`/entities/${selectedType}/bulk-delete`, { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
      toast.success(`Deleted ${selected.size} records`); setSelected(new Set()); loadRecords();
    } catch(e) { toast.error(e.message); }
  };

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Derive display columns from first record
  const SKIP = ['_created_at','_updated_at'];
  const getPreviewCols = (recs) => {
    if (!recs.length) return [];
    const keys = Object.keys(recs[0]).filter(k => !SKIP.includes(k) && !k.startsWith('_'));
    return keys.slice(0, 5);
  };
  const cols = getPreviewCols(records);

  return (
    <div className="flex gap-4">
      {/* Type list */}
      <div className="w-56 flex-shrink-0 border rounded-xl overflow-hidden">
        <div className="bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entity Types</div>
        <div className="overflow-y-auto max-h-[calc(100vh-300px)]">
          {typeCounts.map(({ type, count }) => (
            <button
              key={type}
              onClick={() => selectType(type)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedType === type ? 'bg-primary/10 text-primary font-medium' : ''}`}
            >
              <span className="truncate">{type}</span>
              <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Records table */}
      <div className="flex-1 min-w-0">
        {!selectedType ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Database className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Select an entity type from the left</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 h-9" placeholder="Search records…" value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); loadRecords(selectedType, 1, e.target.value); }} />
              </div>
              <Badge variant="secondary" className="text-xs">{total} records</Badge>
              {selected.size > 0 && (
                <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete {selected.size}
                </Button>
              )}
              <Button size="sm" onClick={() => setNewRecord({})}>
                <Plus className="w-4 h-4 mr-1" /> New
              </Button>
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => loadRecords()}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>

            {loading ? <p className="text-sm text-muted-foreground p-4">Loading…</p> : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-8 px-3 py-2.5"><input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(records.map(r=>r.id)) : new Set())} /></th>
                      {cols.map(c => <th key={c} className="text-left px-3 py-2.5 font-medium text-muted-foreground capitalize">{c.replace(/_/g,' ')}</th>)}
                      <th className="px-3 py-2.5 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {records.map(r => (
                      <tr key={r.id} className={`hover:bg-muted/30 ${selected.has(r.id) ? 'bg-primary/5' : ''}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                        </td>
                        {cols.map(c => (
                          <td key={c} className="px-3 py-2 max-w-[160px] truncate text-muted-foreground">
                            {String(r[c] ?? '—')}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setViewRecord(r)} title="View JSON">
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditRecord(r)} title="Edit">
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => setConfirm(r)} title="Delete">
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
                <span>Page {page} of {pages}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page===1} onClick={() => { const p=page-1; setPage(p); loadRecords(selectedType,p); }}><ChevronLeft className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page>=pages} onClick={() => { const p=page+1; setPage(p); loadRecords(selectedType,p); }}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {viewRecord && <JsonEditorModal title={`View — ${selectedType}`} data={viewRecord} onSave={() => {}} onClose={() => setViewRecord(null)} />}
      {editRecord && <JsonEditorModal title={`Edit — ${selectedType}`} data={editRecord} onSave={handleSaveEdit} onClose={() => setEditRecord(null)} />}
      {newRecord  && <JsonEditorModal title={`New ${selectedType}`} data={newRecord} onSave={handleCreate} onClose={() => setNewRecord(null)} isNew />}
      {confirm && <ConfirmDialog message={`Delete record "${confirm.id}"?`} onConfirm={() => handleDelete(confirm.id)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ── Email settings tab ─────────────────────────────────────
function EmailTab() {
  const [from, setFrom]     = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState(null);

  useEffect(() => {
    adminFetch('/smtp-settings').then(r => setFrom(r.from || '')).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await adminFetch('/smtp-settings', { method: 'POST', body: JSON.stringify({ from }) });
      toast.success('From address saved');
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const checkStatus = async () => {
    setChecking(true); setStatus(null);
    try { setStatus(await adminFetch('/email-status')); }
    catch (e) { setStatus({ ok: false, error: e.message }); }
    finally { setChecking(false); }
  };

  const sendTest = async () => {
    if (!testTo) return toast.error('Enter a recipient email');
    setSending(true);
    try {
      const r = await adminFetch('/test-email', { method: 'POST', body: JSON.stringify({ to: testTo }) });
      toast.success(`Test email sent to ${r.sentTo}`);
      setStatus({ ok: true });
    } catch (e) { toast.error('Send failed: ' + e.message); setStatus({ ok: false, error: e.message }); }
    finally { setSending(false); }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div className="border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Email Settings</h3>
          <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Brevo
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Emails are sent via Brevo. Configure the sender address below.</p>

        <div className="space-y-1">
          <Label className="text-xs">From Address</Label>
          <Input
            value={from}
            onChange={e => setFrom(e.target.value)}
            placeholder="Maxvolt HR <hr@maxvoltenergy.com>"
            className="h-9 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Format: <code>Name &lt;email@domain.com&gt;</code>. The sender domain must be verified in Brevo.
          </p>
        </div>

        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
          Save
        </Button>
      </div>

      <div className="border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Test Email</h3>
        </div>

        {status?.ok && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">Email delivered successfully</p>
          </div>
        )}
        {status && !status.ok && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/30 p-3 flex items-start gap-2">
            <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">{status.error}</p>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={checkStatus} disabled={checking}>
            {checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            Check Connection
          </Button>
          <Input placeholder="recipient@email.com" value={testTo} onChange={e => setTestTo(e.target.value)} className="h-9 text-sm w-52" />
          <Button size="sm" onClick={sendTest} disabled={sending || !testTo}>
            {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
            Send Test
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── AI Settings Tab ────────────────────────────────────────
function AITab() {
  const [status, setStatus]     = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { check(); }, []);

  const check = async (live = false) => {
    setChecking(true); setStatus(null);
    try {
      const r = await base44.functions.invoke(live ? 'testAI' : 'getAIStatus', {});
      setStatus(r.data || r);
    } catch (e) { setStatus({ ok: false, error: e.message }); }
    finally { setChecking(false); }
  };

  return (
    <div className="max-w-xl space-y-5">
      <div className="border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">AI Status</h3>
            <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-medium">Groq</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => check(false)} disabled={checking}>
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button size="sm" onClick={() => check(true)} disabled={checking}>
              <Zap className="w-4 h-4 mr-1" /> Test AI
            </Button>
          </div>
        </div>

        {status?.ok ? (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
              AI is active · {status.provider === 'groq' ? `Groq (${status.model})` : `Ollama (${status.model})`}
            </p>
          </div>
        ) : status ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{status.error || 'AI unavailable — check GROQ_API_KEY in Railway env vars'}</p>
          </div>
        ) : checking ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking…
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          AI is configured via the <code>GROQ_API_KEY</code> environment variable in Railway. No keys are stored or displayed here.
        </p>
      </div>
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────
function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.functions.invoke('getAuditLog', { entity_type: filterType || undefined, limit: 200 });
      setLogs(r?.data?.logs || []);
    } catch { }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterType]);

  const CHANGE_COLORS = { create: 'bg-green-100 text-green-800', update: 'bg-blue-100 text-blue-800', delete: 'bg-red-100 text-red-800', default: 'bg-gray-100 text-gray-700' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">System-wide audit trail of entity changes</p>
        <div className="flex items-center gap-2">
          <select className="border rounded-md px-3 py-1.5 text-sm bg-background" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {['Asset', 'Employee', 'User', 'Leave', 'Payroll', 'Compliance', 'Loan', 'Insurance'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={load} className="p-1.5 rounded border hover:bg-muted"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {loading ? <div className="text-center py-10 text-muted-foreground">Loading audit logs...</div> : (
        <div className="border rounded-xl overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">Entity Type</th>
                <th className="px-4 py-3 text-left">Change</th>
                <th className="px-4 py-3 text-left">Changed By</th>
                <th className="px-4 py-3 text-left">Summary</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No audit logs found</td></tr>
              ) : logs.map((log, i) => (
                <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {log.timestamp ? new Date(log.timestamp).toLocaleString('en-IN') : '-'}
                  </td>
                  <td className="px-4 py-3 font-medium">{log.entity_type || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHANGE_COLORS[log.change_type] || CHANGE_COLORS.default}`}>
                      {log.change_type || 'update'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{log.changed_by_name || log.changed_by || 'System'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate">{log.summary || log.entity_id?.slice(0, 12) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Employee Attributes Tab ────────────────────────────────
function EmployeeAttrsTab() {
  const [employees, setEmployees] = useState([]);
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [editEmp, setEditEmp]     = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [emps, usersRes] = await Promise.all([
          base44.entities.Employee.list('-created_date', 500),
          base44.functions.invoke('getAllUsers', {}),
        ]);
        setEmployees(emps);
        setUsers(usersRes.data.users || []);
      } catch (e) { toast.error(e.message); }
      setLoading(false);
    })();
  }, []);

  const allManagers = employees.filter(e => e.designation || e.department);

  const getName = (uid) => {
    const e = employees.find(x => x.user_id === uid);
    if (e?.display_name) return e.display_name;
    const u = users.find(x => x.id === uid);
    return u ? (u.full_name || u.email) : 'Unknown';
  };

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return !q || getName(e.user_id).toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q) || (e.employee_code || '').toLowerCase().includes(q);
  });

  const openEdit = (emp) => {
    setEditEmp(emp);
    setForm({
      shift:             emp.shift || '',
      department:        emp.department || '',
      location:          emp.location || '',
      reporting_manager: emp.reporting_manager || '',
      designation:       emp.designation || '',
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Employee.update(editEmp.id, form);
      setEmployees(prev => prev.map(e => e.id === editEmp.id ? { ...e, ...form } : e));
      toast.success('Employee attributes updated');
      setEditEmp(null);
    } catch (e) { toast.error(e.message); }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Settings2 className="w-5 h-5 text-primary" /> Employee Attributes</h2>
        <p className="text-sm text-muted-foreground">Change shift, department, location, designation, and reporting manager for any employee.</p>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9 h-9" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="border rounded-xl overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>{['Employee', 'Department', 'Designation', 'Shift', 'Location', 'Reporting Manager', 'Actions'].map(h => (
              <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(emp => (
              <tr key={emp.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">{getName(emp.user_id)}<br/><span className="text-xs text-muted-foreground">{emp.employee_code}</span></td>
                <td className="px-4 py-2.5 text-muted-foreground">{emp.department || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{emp.designation || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{emp.shift || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{emp.location || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{emp.reporting_manager ? getName(emp.reporting_manager) : '—'}</td>
                <td className="px-4 py-2.5">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(emp)}><Edit className="w-3.5 h-3.5" /></Button>
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No employees found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Edit — {getName(editEmp.user_id)}</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditEmp(null)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-3">
              {[['Shift', 'shift'], ['Department', 'department'], ['Location', 'location'], ['Designation', 'designation']].map(([label, key]) => (
                <div key={key}>
                  <Label className="text-xs mb-1 block">{label}</Label>
                  <Input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={label} />
                </div>
              ))}
              <div>
                <Label className="text-xs mb-1 block">Reporting Manager</Label>
                <Select value={form.reporting_manager} onValueChange={v => setForm(f => ({ ...f, reporting_manager: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {employees.filter(e => e.id !== editEmp.id && e.user_id).map(e => (
                      <SelectItem key={e.id} value={e.user_id}>{getName(e.user_id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditEmp(null)}>Cancel</Button>
              <Button size="sm" disabled={saving} onClick={handleSave}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 mr-1" />} Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── API Integration Tab ────────────────────────────────────
function ApiIntegrationTab() {
  const [apiInfo, setApiInfo]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showKey, setShowKey]       = useState(false);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getAttendanceApiInfo', {});
      setApiInfo(res.data);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  useEffect(() => { loadInfo(); }, []);

  const generateKey = async () => {
    if (!window.confirm('Generate a new API key? The old key will be invalidated immediately.')) return;
    setGenerating(true);
    try {
      const res = await base44.functions.invoke('generateAttendanceApiKey', {});
      setApiInfo(p => ({ ...p, api_key: res.data.api_key }));
      setShowKey(true);
      toast.success('New API key generated');
    } catch (e) { toast.error(e.message); }
    setGenerating(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  const endpoint = apiInfo?.endpoint || '';
  const apiKey   = apiInfo?.api_key  || '';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Fingerprint className="w-5 h-5 text-primary" /> External Attendance API</h2>
        <p className="text-sm text-muted-foreground mt-1">Push attendance punch records from biometric devices, mobile apps, or third-party software into this HRMS in real time.</p>
      </div>

      {/* Endpoint */}
      <div className="border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-500" />
          <h3 className="font-semibold text-sm">API Endpoint</h3>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">{endpoint}</code>
          <Button size="sm" variant="outline" onClick={() => copyToClipboard(endpoint)}><Copy className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <p><span className="font-medium">Method:</span> POST · Content-Type: application/json</p>
          <p><span className="font-medium">Auth:</span> Authorization: Bearer &lt;API_KEY&gt; &nbsp;or&nbsp; X-Api-Key: &lt;API_KEY&gt;</p>
        </div>
      </div>

      {/* API Key */}
      <div className="border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-sm">API Key</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowKey(s => !s)}>
              <Eye className="w-3.5 h-3.5 mr-1" /> {showKey ? 'Hide' : 'Show'}
            </Button>
            <Button size="sm" variant="outline" onClick={generateKey} disabled={generating}>
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
              {apiKey ? 'Regenerate' : 'Generate Key'}
            </Button>
          </div>
        </div>
        {apiKey ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono">
              {showKey ? apiKey : '•'.repeat(40)}
            </code>
            {showKey && <Button size="sm" variant="outline" onClick={() => copyToClipboard(apiKey)}><Copy className="w-3.5 h-3.5" /></Button>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No API key set. Click "Generate Key" to create one.</p>
        )}
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Keep this key secret. Anyone with this key can push attendance records to your HRMS.
        </p>
      </div>

      {/* Request Examples */}
      <div className="border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-green-600" />
          <h3 className="font-semibold text-sm">Request Examples</h3>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Single punch (IN/OUT)</p>
          <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-x-auto">{`POST ${endpoint}
Authorization: Bearer ${apiKey || '<YOUR_API_KEY>'}
Content-Type: application/json

{
  "employee_code": "EMP001",
  "punch_time": "${new Date().toISOString()}",
  "type": "in",
  "device_id": "DEVICE01"
}`}</pre>
          <Button size="sm" variant="ghost" className="text-xs mt-1" onClick={() => copyToClipboard(`POST ${endpoint}\nAuthorization: Bearer ${apiKey || '<YOUR_API_KEY>'}\nContent-Type: application/json\n\n{\n  "employee_code": "EMP001",\n  "punch_time": "${new Date().toISOString()}",\n  "type": "in",\n  "device_id": "DEVICE01"\n}`)}>
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Batch punch (multiple employees)</p>
          <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-x-auto">{`POST ${endpoint}
Authorization: Bearer ${apiKey || '<YOUR_API_KEY>'}

{
  "records": [
    { "employee_code": "EMP001", "punch_time": "2024-06-19T09:00:00Z", "type": "in" },
    { "employee_code": "EMP002", "punch_time": "2024-06-19T09:05:00Z", "type": "in" },
    { "employee_code": "EMP001", "punch_time": "2024-06-19T18:30:00Z", "type": "out" }
  ]
}`}</pre>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-1">
          <p className="font-semibold">Field reference</p>
          <p><span className="font-medium">employee_code</span> — matches the Emp Code set during onboarding</p>
          <p><span className="font-medium">punch_time</span> — ISO 8601 format, e.g. 2024-06-19T09:00:00.000Z</p>
          <p><span className="font-medium">type</span> — <code>"in"</code> (check-in) or <code>"out"</code> (check-out)</p>
          <p><span className="font-medium">device_id</span> — optional, identifies which device sent the punch</p>
        </div>
      </div>

      {/* What happens after push */}
      <div className="border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-sm">What happens after a push?</h3>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>The punch record is stored in <strong>Biometric Logs</strong> for audit trail</li>
          <li>Employee is looked up by <code>employee_code</code> (or <code>user_id</code> if provided)</li>
          <li>First punch of the day → creates check-in; subsequent punches update check-out</li>
          <li>Attendance status is computed against the employee's assigned shift rules</li>
          <li>Records appear immediately on the <strong>All Attendance</strong> page</li>
        </ol>
      </div>
    </div>
  );
}

// ── Main AdminPanel page ───────────────────────────────────
export default function AdminPanel() {
  const { user } = useAuth();
  const [tab, setTab]     = useState('entities');
  const [stats, setStats] = useState(null);
  const [typeCounts, setTypeCounts] = useState([]);

  useEffect(() => {
    adminFetch('/stats').then(s => {
      setStats(s);
      setTypeCounts(s.by_type || []);
    }).catch(e => toast.error('Failed to load stats: ' + e.message));
  }, []);

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p>Admin role required to access this panel.</p>
      </div>
    );
  }

  const TABS = [
    { id: 'entities', label: 'Data Browser',     icon: Database },
    { id: 'users',    label: 'User Management',   icon: UserCog  },
    { id: 'emp',      label: 'Employee Attrs',    icon: Settings2 },
    { id: 'stats',    label: 'Statistics',        icon: BarChart3 },
    { id: 'email',    label: 'Email Settings',    icon: Mail },
    { id: 'ai',       label: 'AI Settings',       icon: Bot },
    { id: 'api',      label: 'API Integration',   icon: Fingerprint },
    { id: 'audit',    label: 'Audit Log',         icon: ScrollText },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/10 rounded-lg"><Shield className="w-6 h-6 text-primary" /></div>
        <div>
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, entity data, and system settings</p>
        </div>
      </div>

      <StatsBar stats={stats} />

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'entities' && <EntitiesTab typeCounts={typeCounts} />}
      {tab === 'users'    && <UsersTab />}
      {tab === 'emp'      && <EmployeeAttrsTab />}
      {tab === 'email'    && <EmailTab />}
      {tab === 'ai'       && <AITab />}
      {tab === 'api'      && <ApiIntegrationTab />}
      {tab === 'audit'    && <AuditLogTab />}
      {tab === 'stats'    && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {typeCounts.map(({ type, count }) => (
            <div key={type} className="border rounded-xl p-4">
              <p className="font-semibold text-sm">{type}</p>
              <p className="text-2xl font-bold text-primary mt-1">{count}</p>
              <p className="text-xs text-muted-foreground">records</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
