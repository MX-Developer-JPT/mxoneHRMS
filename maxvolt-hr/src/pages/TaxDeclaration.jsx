import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, CheckCircle2, Clock, Users, AlertCircle, Download } from 'lucide-react';
import { toast } from 'sonner';

const SECTIONS = [
  {
    section: '80C',
    label: 'Section 80C',
    limit: 150000,
    fields: [
      { key: 'life_insurance_premium', label: 'Life Insurance Premium (LIC)' },
      { key: 'ppf', label: 'Public Provident Fund (PPF)' },
      { key: 'elss', label: 'ELSS Mutual Funds' },
      { key: 'nsc', label: 'National Savings Certificate (NSC)' },
      { key: 'home_loan_principal', label: 'Home Loan Principal Repayment' },
      { key: 'tuition_fees', label: "Children's Tuition Fees" },
      { key: 'sukanya_samriddhi', label: 'Sukanya Samriddhi Yojana' },
      { key: 'five_yr_fd', label: '5-Year Tax Saver FD' },
      { key: 'nps_80c', label: 'NPS Contribution (80C portion)' },
    ]
  },
  {
    section: '80D',
    label: 'Section 80D – Health Insurance',
    limit: 50000,
    fields: [
      { key: 'health_insurance_self', label: 'Health Insurance – Self & Family' },
      { key: 'health_insurance_parents', label: 'Health Insurance – Parents' },
      { key: 'preventive_checkup', label: 'Preventive Health Check-up (max ₹5,000)' },
    ]
  },
  {
    section: '80CCD',
    label: 'Section 80CCD(1B) – NPS',
    limit: 50000,
    fields: [
      { key: 'nps_additional', label: 'Additional NPS Contribution (over 80C limit)' },
    ]
  },
  {
    section: 'HRA',
    label: 'HRA Exemption',
    limit: null,
    fields: [
      { key: 'hra_rent_paid', label: 'Annual Rent Paid' },
      { key: 'hra_city', label: 'City (Metro/Non-Metro)', type: 'select', options: ['Metro', 'Non-Metro'] },
      { key: 'hra_landlord_name', label: "Landlord's Name" },
      { key: 'hra_landlord_pan', label: "Landlord's PAN (if rent > ₹1L/year)" },
    ]
  },
  {
    section: '80E',
    label: 'Section 80E – Education Loan Interest',
    limit: null,
    fields: [
      { key: 'education_loan_interest', label: 'Education Loan Interest Paid' },
    ]
  },
  {
    section: '80G',
    label: 'Section 80G – Donations',
    limit: null,
    fields: [
      { key: 'donations_100pct', label: 'Donations – 100% deductible' },
      { key: 'donations_50pct', label: 'Donations – 50% deductible' },
    ]
  },
];

function getCurrentFY() {
  const now = new Date();
  const yr = now.getFullYear();
  return now.getMonth() >= 3 ? `${yr}-${yr + 1}` : `${yr - 1}-${yr}`;
}

export default function TaxDeclaration() {
  const [user, setUser] = useState(null);
  const [declarations, setDeclarations] = useState({});
  const [existing, setExisting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('declare');
  const [summaryList, setSummaryList] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const fy = getCurrentFY();

  const isHR = user && (['admin', 'hr'].includes(user.role) || ['admin', 'hr'].includes(user.custom_role));

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      base44.functions.invoke('getTaxDeclaration', { user_id: u.id, financial_year: fy })
        .then(r => {
          if (r?.data?.declaration) {
            setExisting(r.data.declaration);
            setDeclarations(r.data.declaration.declarations || {});
          }
        }).catch(() => {});
    });
  }, []);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const r = await base44.functions.invoke('getTaxDeclarationSummary', { financial_year: fy });
      setSummaryList(r?.data?.declarations || []);
    } catch { toast.error('Failed to load summary'); }
    setSummaryLoading(false);
  };

  useEffect(() => { if (activeTab === 'summary' && isHR) loadSummary(); }, [activeTab]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const r = await base44.functions.invoke('submitTaxDeclaration', { user_id: user.id, financial_year: fy, declarations });
      const d = r?.data || r;
      if (!d?.success) { toast.error(d?.error || 'Submission failed'); setSaving(false); return; }
      toast.success(`Declaration submitted. Total declared: ₹${(d?.total_declared||0).toLocaleString('en-IN')}`);
      setExisting({ ...existing, declarations, status: 'submitted', total_declared: d?.total_declared });
    } catch (e) { toast.error('Failed to submit: ' + e.message); }
    setSaving(false);
  };

  const handleApprove = async (decl) => {
    try {
      await base44.functions.invoke('approveTaxDeclaration', { user_id: decl.user_id, financial_year: fy, approved_by: user.id });
      toast.success('Declaration approved');
      loadSummary();
    } catch (e) { toast.error(e.message); }
  };

  const totalDeclared = Object.values(declarations).filter(v => !isNaN(Number(v))).reduce((s, v) => s + Number(v || 0), 0);

  const section80CTotal = SECTIONS[0].fields.reduce((s, f) => s + Number(declarations[f.key] || 0), 0);
  const section80CLimited = Math.min(section80CTotal, 150000);

  if (!user) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tax Declaration</h1>
          <p className="text-gray-500 text-sm">Financial Year {fy} · Form 12BB Investment Declaration</p>
        </div>
        {existing?.status === 'submitted' && <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1 inline" /> Awaiting HR Approval</Badge>}
        {existing?.status === 'approved' && <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1 inline" /> Approved</Badge>}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="declare">My Declaration</TabsTrigger>
          {isHR && <TabsTrigger value="summary"><Users className="w-3.5 h-3.5 mr-1" /> HR Summary</TabsTrigger>}
        </TabsList>

        <TabsContent value="declare" className="space-y-4 mt-4">
          {existing?.status === 'approved' && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm text-green-800">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Your declaration has been approved by HR. Total approved: ₹{(existing.total_declared||0).toLocaleString('en-IN')}
            </div>
          )}

          {/* Summary bar */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 flex flex-wrap gap-6 items-center">
              <div><p className="text-xs text-blue-600 font-medium">Total Declared</p><p className="text-2xl font-bold text-blue-900">₹{totalDeclared.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-blue-600 font-medium">80C Total (capped at ₹1.5L)</p><p className="text-lg font-semibold text-blue-800">₹{section80CLimited.toLocaleString('en-IN')}</p></div>
              <div className="ml-auto">
                <p className="text-xs text-blue-600">Est. Tax Saved (30% slab)</p>
                <p className="text-lg font-bold text-green-700">₹{Math.round(section80CLimited * 0.3).toLocaleString('en-IN')}</p>
              </div>
            </CardContent>
          </Card>

          {SECTIONS.map(sec => (
            <Card key={sec.section}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  {sec.label}
                  {sec.limit && <span className="text-xs text-gray-500 font-normal">Max deduction: ₹{sec.limit.toLocaleString('en-IN')}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {sec.fields.map(f => (
                    <div key={f.key}>
                      <label className="text-xs font-medium text-gray-600 block mb-1">{f.label}</label>
                      {f.type === 'select' ? (
                        <select
                          className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                          value={declarations[f.key] || ''}
                          onChange={e => setDeclarations(d => ({ ...d, [f.key]: e.target.value }))}
                        >
                          <option value="">Select...</option>
                          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.key.includes('name') || f.key.includes('pan') || f.key.includes('city') ? (
                        <Input value={declarations[f.key] || ''} onChange={e => setDeclarations(d => ({ ...d, [f.key]: e.target.value }))} placeholder="Enter..." />
                      ) : (
                        <Input type="number" min={0} value={declarations[f.key] || ''} onChange={e => setDeclarations(d => ({ ...d, [f.key]: e.target.value }))} placeholder="₹ 0" />
                      )}
                    </div>
                  ))}
                </div>
                {sec.limit && (() => {
                  const secTotal = sec.fields.reduce((s, f) => s + Number(declarations[f.key] || 0), 0);
                  if (secTotal > 0) return <p className="text-xs mt-2 text-gray-500">Section total: ₹{secTotal.toLocaleString('en-IN')}{sec.limit && secTotal > sec.limit ? <span className="text-orange-600 ml-2">⚠ Exceeds limit by ₹{(secTotal-sec.limit).toLocaleString('en-IN')}</span> : ''}</p>;
                })()}
              </CardContent>
            </Card>
          ))}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeclarations({})}>Clear All</Button>
            <Button onClick={handleSubmit} disabled={saving || existing?.status === 'approved'} className="bg-blue-600 hover:bg-blue-700">
              <FileText className="w-4 h-4 mr-2" />{saving ? 'Submitting...' : existing ? 'Update & Resubmit' : 'Submit Declaration'}
            </Button>
          </div>
        </TabsContent>

        {isHR && (
          <TabsContent value="summary" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  Employee Declarations — FY {fy}
                  <Button variant="outline" size="sm" onClick={loadSummary}>Refresh</Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? <p className="text-center py-6 text-gray-400">Loading...</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-3 text-left">Employee</th>
                          <th className="px-4 py-3 text-right">Total Declared</th>
                          <th className="px-4 py-3 text-center">Status</th>
                          <th className="px-4 py-3 text-center">Submitted</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryList.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-8 text-gray-400">No declarations submitted yet</td></tr>
                        ) : summaryList.map(d => (
                          <tr key={d.id} className="border-t">
                            <td className="px-4 py-3 font-medium">{d.full_name || d.user_id}</td>
                            <td className="px-4 py-3 text-right font-semibold">₹{(d.total_declared||0).toLocaleString('en-IN')}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge className={d.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
                                {d.status === 'approved' ? '✓ Approved' : 'Pending'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center text-gray-500 text-xs">{d.submitted_at ? new Date(d.submitted_at).toLocaleDateString('en-IN') : '-'}</td>
                            <td className="px-4 py-3 text-center">
                              {d.status !== 'approved' ? (
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(d)}>Approve</Button>
                              ) : (
                                <span className="text-xs text-gray-400">Done</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
