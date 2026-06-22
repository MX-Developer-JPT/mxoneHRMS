import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  FileCheck, Mail, Phone, Loader2, Send, CalendarCheck, Copy, RefreshCw,
  Search, Users, CheckCircle2, Clock, XCircle, FileText, Building2, MapPin, User,
} from 'lucide-react';
import { openLetterheadPrintWindow } from '@/utils/letterhead';

const TODAY = new Date().toISOString().slice(0, 10);

function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }

function calcSalary(annualCTC) {
  const m = Math.round(annualCTC / 12);
  const basic = Math.round(m * 0.5);
  const hra = Math.round(m * 0.2);
  const conv = Math.round(m * 0.05);
  const lta = Math.round(m * 0.1);
  const pfWage = Math.min(basic, 15000);
  const pfEmp = Math.round(pfWage * 0.12);
  const pfEmployer = Math.round(pfWage * 0.13);
  const medical = 330;
  const bonus = Math.round(basic * 0.0833);
  const contrib = pfEmployer + medical + bonus;
  const gross = m - contrib;
  const special = gross - basic - hra - conv - lta;
  return {
    monthly_ctc: m, annual_ctc: annualCTC,
    basic_monthly: basic, basic_annual: basic * 12,
    hra_monthly: hra, hra_annual: hra * 12,
    conveyance_monthly: conv, conveyance_annual: conv * 12,
    lta_monthly: lta, lta_annual: lta * 12,
    special_monthly: special, special_annual: special * 12,
    gross_monthly: gross, gross_annual: gross * 12,
    pf_emp_monthly: pfEmp, pf_emp_annual: pfEmp * 12,
    pf_employer_monthly: pfEmployer, pf_employer_annual: pfEmployer * 12,
    medical_monthly: medical, medical_annual: medical * 12,
    bonus_monthly: bonus, bonus_annual: bonus * 12,
    contribution_monthly: contrib, contribution_annual: contrib * 12,
    net_monthly: gross - pfEmp, net_annual: (gross - pfEmp) * 12,
  };
}

const STATUS_CONFIG = {
  offered:       { label: 'Sent',         color: 'bg-teal-100 text-teal-800',     icon: Send },
  offer_accepted:{ label: 'Accepted',     color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  joined:        { label: 'Joined',       color: 'bg-green-200 text-green-900',    icon: Users },
  selected:      { label: 'Selected',     color: 'bg-blue-100 text-blue-800',      icon: FileCheck },
  interview_done:{ label: 'Interviewed',  color: 'bg-purple-100 text-purple-800',  icon: Clock },
};

function ResendOfferDialog({ candidate, onClose, onRefresh }) {
  const [form, setForm] = useState({
    joining_date: candidate?.joining_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    designation: candidate?.designation || candidate?.position_applied || '',
    department: candidate?.department || '',
    location: candidate?.location || 'Ghaziabad, Uttar Pradesh',
    reporting_to: candidate?.reporting_to || '',
    annual_ctc: candidate?.offer_ctc_annual || candidate?.expected_ctc || 0,
    probation_months: candidate?.probation_months || 6,
    offer_valid_days: 7,
    notes: '',
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [acceptLink, setAcceptLink] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const sal = calcSalary(Number(form.annual_ctc) || 0);
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await base44.functions.invoke('generateOfferLetter', {
        candidate_id: candidate.id,
        joining_date: form.joining_date,
        designation: form.designation,
        department: form.department,
        location: form.location,
        reporting_to: form.reporting_to,
        ctc: Number(form.annual_ctc),
        probation_months: Number(form.probation_months),
      });
      if (res.data?.success) {
        openLetterheadPrintWindow(`Offer Letter — ${candidate.full_name}`, res.data.html, '', false);
      } else toast.error(res.data?.error || 'Preview failed');
    } catch (e) { toast.error(e.message); }
    setPreviewing(false);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await base44.functions.invoke('sendOfferLetter', {
        candidate_id: candidate.id,
        joining_date: form.joining_date,
        designation: form.designation,
        department: form.department,
        location: form.location,
        reporting_to: form.reporting_to,
        annual_ctc: Number(form.annual_ctc),
        probation_months: Number(form.probation_months),
        offer_valid_days: Number(form.offer_valid_days),
        notes: form.notes,
      });
      if (res.data?.success) {
        setSent(true);
        setAcceptLink(res.data.accept_link || '');
        toast.success('Offer letter sent to ' + candidate.email);
        onRefresh();
      } else toast.error(res.data?.error || 'Failed to send');
    } catch (e) { toast.error(e.message); }
    setSending(false);
  };

  if (sent) return (
    <div className="text-center py-6 space-y-4">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-8 h-8 text-green-600" />
      </div>
      <h3 className="font-semibold text-lg">Offer Letter Sent!</h3>
      <p className="text-sm text-gray-500">Sent to <strong>{candidate.email}</strong></p>
      {acceptLink && (
        <div className="bg-gray-50 rounded-lg p-3 text-left">
          <p className="text-xs text-gray-500 mb-1">Candidate acceptance link:</p>
          <div className="flex items-center gap-2">
            <code className="text-xs text-blue-700 flex-1 truncate">{acceptLink}</code>
            <button onClick={() => { navigator.clipboard.writeText(acceptLink); toast.success('Copied!'); }}
              className="p-1 hover:bg-gray-200 rounded">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      <Button onClick={onClose} variant="outline">Close</Button>
    </div>
  );

  return (
    <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
      <p className="text-sm text-gray-500">
        {candidate.status === 'offered' ? 'Resend' : 'Send'} offer letter to{' '}
        <strong>{candidate.full_name}</strong> ({candidate.email})
      </p>

      <div className="grid md:grid-cols-2 gap-3">
        {[
          ['Joining Date *', 'joining_date', 'date'],
          ['Probation (months)', 'probation_months', 'number'],
          ['Designation', 'designation', 'text'],
          ['Department', 'department', 'text'],
          ['Work Location', 'location', 'text'],
          ['Reporting To', 'reporting_to', 'text'],
          ['Annual CTC (₹)', 'annual_ctc', 'number'],
          ['Offer Valid (days)', 'offer_valid_days', 'number'],
        ].map(([label, key, type]) => (
          <div key={key}>
            <Label className="text-xs">{label}</Label>
            <Input type={type} value={form[key]} onChange={e => setF(key, e.target.value)}
              placeholder={key === 'reporting_to' ? 'Manager name' : ''} />
          </div>
        ))}
        <div className="md:col-span-2">
          <Label className="text-xs">Additional Notes (optional)</Label>
          <Textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2} />
        </div>
      </div>

      {/* Salary preview */}
      {Number(form.annual_ctc) > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">Salary Preview</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-3 py-1.5 border-b">Component</th>
                <th className="text-right px-3 py-1.5 border-b">Annual (₹)</th>
                <th className="text-right px-3 py-1.5 border-b">Monthly (₹)</th>
              </tr>
            </thead>
            <tbody>
              {[['Basic', sal.basic_annual, sal.basic_monthly],['HRA', sal.hra_annual, sal.hra_monthly],['Conveyance', sal.conveyance_annual, sal.conveyance_monthly],['LTA', sal.lta_annual, sal.lta_monthly],['Special Allowance', sal.special_annual, sal.special_monthly]].map(([l, a, m]) => (
                <tr key={l} className="border-b"><td className="px-3 py-1">{l}</td><td className="px-3 py-1 text-right">{fmt(a)}</td><td className="px-3 py-1 text-right">{fmt(m)}</td></tr>
              ))}
              <tr className="bg-blue-50 font-semibold border-b"><td className="px-3 py-1.5">Gross (A)</td><td className="px-3 py-1.5 text-right">{fmt(sal.gross_annual)}</td><td className="px-3 py-1.5 text-right">{fmt(sal.gross_monthly)}</td></tr>
              <tr className="border-b text-gray-500"><td className="px-3 py-1">PF Deduction</td><td className="px-3 py-1 text-right">-{fmt(sal.pf_emp_annual)}</td><td className="px-3 py-1 text-right">-{fmt(sal.pf_emp_monthly)}</td></tr>
              <tr className="bg-green-50 font-semibold border-b"><td className="px-3 py-1.5">Net Take-Home</td><td className="px-3 py-1.5 text-right">{fmt(sal.net_annual)}</td><td className="px-3 py-1.5 text-right">{fmt(sal.net_monthly)}</td></tr>
              <tr className="bg-orange-50 font-bold"><td className="px-3 py-1.5">Annual CTC</td><td className="px-3 py-1.5 text-right">{fmt(sal.annual_ctc)}</td><td className="px-3 py-1.5 text-right">{fmt(sal.monthly_ctc)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-3 pt-1">
        <Button variant="outline" onClick={handlePreview} disabled={previewing} className="flex-1">
          {previewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
          Preview
        </Button>
        <Button onClick={handleSend} disabled={sending || !form.joining_date} className="flex-1 bg-green-600 hover:bg-green-700">
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          Send to Candidate
        </Button>
      </div>
      <p className="text-xs text-gray-400 text-center">
        Sends offer + consent form to {candidate.email} with a digital acceptance link
      </p>
    </div>
  );
}

export default function OfferLetters() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogCandidate, setDialogCandidate] = useState(null);
  const [invitingId, setInvitingId] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.Candidate.list('-created_date', 500);
      const relevant = all.filter(c =>
        ['selected', 'interview_done', 'offered', 'offer_accepted', 'joined'].includes(c.status)
      );
      setCandidates(relevant);
    } catch (e) { toast.error('Failed to load data'); }
    setLoading(false);
  };

  const handleInvite = async (c) => {
    setInvitingId(c.id);
    try {
      const res = await base44.functions.invoke('inviteJoinerToApp', { candidate_id: c.id });
      if (res.data?.success) { toast.success('Invitation sent to ' + c.email); loadData(); }
      else toast.error(res.data?.error || 'Failed to send invite');
    } catch (e) { toast.error(e.message); }
    setInvitingId(null);
  };

  const copyAcceptLink = (c) => {
    const base = 'https://hr.maxvolt-one.co.in';
    if (c.offer_accept_token) {
      navigator.clipboard.writeText(`${base}/offer-accept/${c.offer_accept_token}`);
      toast.success('Acceptance link copied!');
    } else {
      toast.error('No acceptance link — please send the offer letter first');
    }
  };

  const filtered = candidates.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.full_name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.position_applied?.toLowerCase().includes(q) || c.department?.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: candidates.length,
    sent: candidates.filter(c => c.status === 'offered').length,
    accepted: candidates.filter(c => c.status === 'offer_accepted').length,
    joined: candidates.filter(c => c.status === 'joined').length,
    joiningToday: candidates.filter(c => c.joining_date === TODAY && c.status === 'offer_accepted').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-teal-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <FileCheck className="w-8 h-8 text-green-600" />
              Offer Letters
            </h1>
            <p className="text-gray-500 mt-1">Manage, track, and send offer letters to selected candidates</p>
          </div>
          <Button onClick={loadData} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total',          value: stats.total,        color: 'text-gray-700',    bg: 'bg-gray-100',    filter: 'all' },
            { label: 'Offer Sent',     value: stats.sent,         color: 'text-teal-700',    bg: 'bg-teal-100',    filter: 'offered' },
            { label: 'Accepted',       value: stats.accepted,     color: 'text-emerald-700', bg: 'bg-emerald-100', filter: 'offer_accepted' },
            { label: 'Joined',         value: stats.joined,       color: 'text-green-700',   bg: 'bg-green-100',   filter: 'joined' },
            { label: 'Joining Today',  value: stats.joiningToday, color: 'text-purple-700',  bg: 'bg-purple-100',  filter: 'offer_accepted' },
          ].map(s => (
            <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(s.filter)}>
              <CardContent className="p-4 text-center">
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-48">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input className="pl-9" placeholder="Name, email, position..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="w-44">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="selected">Selected</SelectItem>
                    <SelectItem value="interview_done">Interviewed</SelectItem>
                    <SelectItem value="offered">Offer Sent</SelectItem>
                    <SelectItem value="offer_accepted">Accepted</SelectItem>
                    <SelectItem value="joined">Joined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Offer Letters Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Offer Letters
              <span className="ml-2 text-sm font-normal text-gray-500">({filtered.length} candidates)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-green-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <FileCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No candidates found</p>
                <p className="text-sm mt-1">Select candidates from the Recruitment page to create offer letters</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(c => {
                  const sc = STATUS_CONFIG[c.status] || { label: c.status, color: 'bg-gray-100 text-gray-700', icon: FileText };
                  const StatusIcon = sc.icon;
                  const isJoiningToday = c.joining_date === TODAY;
                  const ctc = c.offer_ctc_annual || c.expected_ctc || 0;

                  return (
                    <div key={c.id} className={`border rounded-xl p-4 transition-colors ${isJoiningToday ? 'border-purple-300 bg-purple-50/50' : 'hover:bg-gray-50'}`}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        {/* Left: Candidate info */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-green-700 font-semibold text-sm">{c.full_name?.charAt(0).toUpperCase()}</span>
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{c.full_name}</p>
                              <p className="text-sm text-gray-500">{c.designation || c.position_applied} · {c.department}</p>
                            </div>
                            <Badge className={sc.color + ' flex items-center gap-1'}>
                              <StatusIcon className="w-3 h-3" />
                              {sc.label}
                            </Badge>
                            {isJoiningToday && c.status === 'offer_accepted' && (
                              <Badge className="bg-purple-100 text-purple-800 animate-pulse">Joining Today!</Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                            <div className="flex items-center gap-1.5">
                              <Mail className="w-3 h-3 text-gray-400" />
                              <span className="truncate">{c.email}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Phone className="w-3 h-3 text-gray-400" />
                              <span>{c.phone || '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <CalendarCheck className="w-3 h-3 text-gray-400" />
                              <span>Joining: <strong>{c.joining_date ? format(new Date(c.joining_date), 'dd MMM yyyy') : '—'}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3 h-3 text-gray-400" />
                              <span>CTC: <strong>₹{fmt(ctc)}/yr</strong></span>
                            </div>
                          </div>

                          {c.offer_accepted_at && (
                            <p className="text-xs text-emerald-600">
                              Accepted on {format(new Date(c.offer_accepted_at), 'dd MMM yyyy, hh:mm a')}
                              {c.offer_parent_name && ` · S/D of ${c.offer_parent_name}`}
                              {c.offer_contact && ` · ${c.offer_contact}`}
                            </p>
                          )}
                          {c.offer_letter_date && c.status === 'offered' && (
                            <p className="text-xs text-teal-600">
                              Offer sent on {format(new Date(c.offer_letter_date), 'dd MMM yyyy')}
                              {c.offer_valid_till && ` · Valid till ${format(new Date(c.offer_valid_till), 'dd MMM yyyy')}`}
                            </p>
                          )}
                          {c.offer_ref && (
                            <p className="text-xs text-gray-400">Ref: {c.offer_ref}</p>
                          )}
                        </div>

                        {/* Right: Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          {/* Send / Resend offer */}
                          <Button
                            size="sm"
                            variant={c.status === 'offered' ? 'outline' : 'default'}
                            onClick={() => setDialogCandidate(c)}
                            className={c.status === 'offered' ? 'border-teal-300 text-teal-700 hover:bg-teal-50' : 'bg-green-600 hover:bg-green-700 text-white'}
                          >
                            {c.status === 'offered'
                              ? <><RefreshCw className="w-3 h-3 mr-1" /> Resend Offer</>
                              : <><Send className="w-3 h-3 mr-1" /> Send Offer</>
                            }
                          </Button>

                          {/* Copy acceptance link */}
                          {c.status === 'offered' && c.offer_accept_token && (
                            <Button size="sm" variant="outline" onClick={() => copyAcceptLink(c)} className="text-xs">
                              <Copy className="w-3 h-3 mr-1" /> Copy Link
                            </Button>
                          )}

                          {/* Invite to app */}
                          {isJoiningToday && c.status === 'offer_accepted' && (
                            <Button
                              size="sm"
                              onClick={() => handleInvite(c)}
                              disabled={invitingId === c.id}
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                            >
                              {invitingId === c.id
                                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                : <CalendarCheck className="w-3 h-3 mr-1" />
                              }
                              Invite to App
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send/Resend Dialog */}
      <Dialog open={!!dialogCandidate} onOpenChange={open => { if (!open) setDialogCandidate(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-green-600" />
              {dialogCandidate?.status === 'offered' ? 'Resend' : 'Send'} Offer Letter — {dialogCandidate?.full_name}
            </DialogTitle>
          </DialogHeader>
          {dialogCandidate && (
            <ResendOfferDialog
              candidate={dialogCandidate}
              onClose={() => setDialogCandidate(null)}
              onRefresh={loadData}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
