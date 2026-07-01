import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Shield, AlertTriangle, Users, CheckCircle, FileText } from 'lucide-react';

const RECORD_TYPES = [
  { value: 'training', label: 'Training' },
  { value: 'complaint', label: 'Complaint' },
  { value: 'icc_meeting', label: 'ICC Meeting' },
  { value: 'annual_report', label: 'Annual Report' },
  { value: 'awareness_program', label: 'Awareness Program' },
];

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-green-100 text-green-700',
};

const TYPE_COLORS = {
  training: 'bg-blue-100 text-blue-700',
  complaint: 'bg-red-100 text-red-700',
  icc_meeting: 'bg-purple-100 text-purple-700',
  annual_report: 'bg-gray-100 text-gray-700',
  awareness_program: 'bg-teal-100 text-teal-700',
};

export default function POSHCompliance() {
  const [activeTab, setActiveTab] = useState('records');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    record_type: '',
    date: '',
    description: '',
    parties: '',
    action_taken: '',
    status: 'open',
    outcome: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getPOSHData', {});
      setData(result.data || result);
    } catch (e) {
      toast.error('Failed to load POSH data');
      setData({ records: [], total: 0, open: 0, closed: 0 });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.record_type || !form.date) { toast.error('Record type and date are required'); return; }
    setSaving(true);
    try {
      await base44.functions.invoke('savePOSHRecord', { ...form });
      toast.success('Record saved successfully');
      setForm({ record_type: '', date: '', description: '', parties: '', action_taken: '', status: 'open', outcome: '' });
      await loadData();
      setActiveTab('records');
    } catch (e) {
      toast.error('Failed to save record');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  const records = data?.records || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">POSH Compliance</h1>
        <p className="text-gray-500 text-sm mt-1">Prevention of Sexual Harassment — records and compliance tracking</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Records</p>
              <p className="text-xl font-bold text-gray-900">{data?.total ?? records.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Open Cases</p>
              <p className="text-xl font-bold text-gray-900">{data?.open ?? records.filter(r => r.status === 'open').length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Closed Cases</p>
              <p className="text-xl font-bold text-gray-900">{data?.closed ?? records.filter(r => r.status === 'closed').length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-1 mb-4 border-b">
        {['records', 'add'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'records' ? 'Records' : 'Add Record'}
          </button>
        ))}
      </div>

      {activeTab === 'records' && (
        <Card>
          <CardContent className="p-0">
            {records.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No POSH records found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {records.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${TYPE_COLORS[r.record_type] || 'bg-gray-100 text-gray-600'}`}>
                            {RECORD_TYPES.find(t => t.value === r.record_type)?.label || r.record_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{r.date}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{r.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'add' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add New POSH Record</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Record Type *</label>
                  <Select value={form.record_type} onValueChange={v => setForm(f => ({ ...f, record_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {RECORD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description of the record..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parties Involved</label>
                <textarea
                  value={form.parties}
                  onChange={e => setForm(f => ({ ...f, parties: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Names of parties involved..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Taken</label>
                <textarea
                  value={form.action_taken}
                  onChange={e => setForm(f => ({ ...f, action_taken: e.target.value }))}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Actions taken..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
                  <textarea
                    value={form.outcome}
                    onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}
                    rows={1}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Final outcome..."
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving} className="flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  Save Record
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
