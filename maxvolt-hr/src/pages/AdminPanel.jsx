import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Database, Users, RefreshCw, Trash2, Edit, Plus, Search,
  ChevronLeft, ChevronRight, Eye, Key, AlertTriangle, X, Check,
  BarChart3, Table2, UserCog, Shield, Mail, Send, CheckCircle2, XCircle, Loader2
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

// ── User management tab ────────────────────────────────────
function UsersTab() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [editUser, setEditUser]     = useState(null);
  const [newUserForm, setNewUserForm] = useState(null);
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
      toast.success('User created'); setNewUserForm(null); load();
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

  const ROLE_COLORS = { admin:'bg-red-100 text-red-800', hr:'bg-purple-100 text-purple-800', employee:'bg-blue-100 text-blue-800', manager:'bg-orange-100 text-orange-800', gate_admin:'bg-green-100 text-green-800' };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Search users…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setNewUserForm({ email:'', password:'', full_name:'', role:'employee' })}>
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground p-4">Loading…</p> : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{['Name','Email','Role','Actions'].map(h=><th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{u.full_name || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role]||'bg-gray-100 text-gray-700'}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditUser(u)} title="Edit">
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPwdModal(u)} title="Reset password">
                        <Key className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setConfirm(u)} title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editUser && (
        <JsonEditorModal title={`Edit User — ${editUser.email}`} data={{ full_name:editUser.full_name, role:editUser.role, custom_role:editUser.custom_role, email:editUser.email }} onSave={handleSaveEdit} onClose={() => setEditUser(null)} />
      )}
      {newUserForm && (
        <JsonEditorModal title="Create New User" data={newUserForm} onSave={handleCreate} onClose={() => setNewUserForm(null)} isNew />
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
  const [status, setStatus]         = useState(null);   // null = not checked
  const [checking, setChecking]     = useState(false);
  const [sending, setSending]       = useState(false);
  const [testTo, setTestTo]         = useState('');

  const checkStatus = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const r = await adminFetch('/email-status');
      setStatus(r);
    } catch (e) {
      setStatus({ ok: false, error: e.message });
    } finally {
      setChecking(false);
    }
  };

  const sendTest = async () => {
    if (!testTo) return toast.error('Enter a recipient email address');
    setSending(true);
    try {
      const r = await adminFetch('/test-email', {
        method: 'POST',
        body: JSON.stringify({ to: testTo }),
      });
      toast.success(`Test email sent to ${r.sentTo}`);
    } catch (e) {
      toast.error('Send failed: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* SMTP status card */}
      <div className="border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">SMTP Connection</h3>
        </div>

        {status === null && (
          <p className="text-sm text-muted-foreground">
            Click <strong>Check Connection</strong> to verify your Gmail SMTP settings.
          </p>
        )}
        {status?.ok && (
          <div className="flex items-center gap-2 text-green-600 mb-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-medium">Connected — {status.user}</span>
          </div>
        )}
        {status && !status.ok && (
          <div className="flex items-start gap-2 text-destructive mb-2">
            <XCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <p className="text-sm">{status.error}</p>
          </div>
        )}

        <Button size="sm" variant="outline" onClick={checkStatus} disabled={checking} className="mt-3">
          {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Check Connection
        </Button>
      </div>

      {/* Test email card */}
      <div className="border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Send className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Send Test Email</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Sends a test email to verify the full delivery pipeline.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="recipient@example.com"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
            className="h-9 max-w-xs"
          />
          <Button size="sm" onClick={sendTest} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send
          </Button>
        </div>
      </div>

      {/* Setup instructions */}
      <div className="border rounded-xl p-5 bg-amber-50/50 border-amber-200">
        <h3 className="font-semibold text-amber-800 mb-3">Gmail App Password Setup</h3>
        <ol className="text-sm text-amber-700 space-y-2 list-decimal list-inside">
          <li>Go to <strong>myaccount.google.com/security</strong></li>
          <li>Enable <strong>2-Step Verification</strong> (required)</li>
          <li>Search for <strong>"App Passwords"</strong> and create one</li>
          <li>Copy the 16-character password (spaces don't matter)</li>
          <li>Open <code className="bg-amber-100 px-1 rounded text-xs font-mono">backend/.env</code> and paste it as <code className="bg-amber-100 px-1 rounded text-xs font-mono">SMTP_PASS=</code></li>
          <li>Restart the backend server</li>
          <li>Click <strong>Check Connection</strong> above to confirm</li>
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

  if (!['admin','hr'].includes(user?.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Shield className="w-10 h-10 mb-3 opacity-40" />
        <p>Admin or HR role required to access this panel.</p>
      </div>
    );
  }

  const TABS = [
    { id: 'entities', label: 'Data Browser',     icon: Database },
    { id: 'users',    label: 'User Management',   icon: UserCog  },
    { id: 'stats',    label: 'Statistics',        icon: BarChart3 },
    { id: 'email',    label: 'Email Settings',    icon: Mail },
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
      {tab === 'email'    && <EmailTab />}
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
