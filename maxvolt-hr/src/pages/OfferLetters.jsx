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
import { safeDate } from '@/lib/dateUtils';
import {
  FileCheck, Mail, Phone, Loader2, Send, CalendarCheck, Copy, RefreshCw,
  Search, Users, CheckCircle2, Clock, XCircle, FileText, Building2, MapPin, User,
  ChevronDown, ChevronsUpDown, Check, Pencil, ShieldCheck, Upload, AlertTriangle, Download,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import OfferBuilder from '@/components/offers/OfferBuilder';
import { openPdfBlob } from '@/utils/letterhead';
import OfferRegister from '@/components/offers/OfferRegister';
import EmployeeProfileDialog from '@/components/offers/EmployeeProfileDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TODAY = new Date().toISOString().slice(0, 10);

function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
// where the offer came from (the server applies the same rule)
const sourceOf = (c) => (c.requisition_id || c.job_requisition_id || c.job_id ? 'mrf' : c.offer_source === 'direct' || c.source === 'direct_offer' ? 'direct' : 'recruitment');
const SOURCE_BADGE = { direct: ['Direct', 'bg-purple-100 text-purple-800'], mrf: ['MRF', 'bg-blue-100 text-blue-800'], recruitment: ['Recruitment', 'bg-slate-100 text-slate-700'] };

const STATUS_CONFIG = {
  offered:        { label: 'Sent',         color: 'bg-teal-100 text-teal-800',      icon: Send },
  offer_accepted: { label: 'Accepted',     color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  offer_declined: { label: 'Declined',     color: 'bg-red-100 text-red-800',        icon: XCircle },
  joined:         { label: 'Joined',       color: 'bg-green-200 text-green-900',    icon: Users },
  selected:       { label: 'Selected',     color: 'bg-blue-100 text-blue-800',      icon: FileCheck },
  interview_done: { label: 'Interviewed',  color: 'bg-purple-100 text-purple-800',  icon: Clock },
};

const CANDIDATE_DOC_TYPES = [
  { key: 'aadhaar_card', label: 'Aadhaar Card' },
  { key: 'salary_slips', label: "Last 3 Months' Salary Slips" },
  { key: 'bank_statements', label: "Last 6 Months' Bank Statements" },
];
const DOC_STATUS_CONFIG = {
  pending:    { label: 'Pending',    color: 'bg-gray-100 text-gray-600',   icon: Clock },
  submitted:  { label: 'Submitted',  color: 'bg-blue-100 text-blue-700',   icon: FileText },
  verified:   { label: 'Verified',   color: 'bg-green-100 text-green-700', icon: ShieldCheck },
  rejected:   { label: 'Rejected',   color: 'bg-red-100 text-red-700',     icon: XCircle },
};

// HR-side per-candidate document review — verify or reject each of the 3
// mandatory pre-offer documents (with a required reason on reject, which
// re-emails the candidate the same submission link). The offer letter
// cannot be sent until every one of these reads "Verified" — enforced here
// visually (Send Offer stays disabled) and again, non-bypassably, on the
// server inside sendOfferLetter.
function CandidateDocReviewDialog({ candidate, onClose, onRefresh }) {
  const [busyKey, setBusyKey] = useState(null);
  const [rejectDialog, setRejectDialog] = useState(null); // { docKey, label }
  const [rejectReason, setRejectReason] = useState('');
  const docs = candidate.documents || {};

  const act = async (docKey, action, reason) => {
    setBusyKey(docKey);
    try {
      const res = await base44.functions.invoke('verifyCandidateDocument', {
        candidate_id: candidate.id, doc_key: docKey, action, reason,
      });
      if (res.data?.success) {
        toast.success(action === 'verified' ? 'Document verified' : 'Document rejected — candidate notified to resubmit');
        onRefresh();
      } else toast.error(res.data?.error || 'Action failed');
    } catch (e) { toast.error(e.message); }
    setBusyKey(null);
    setRejectDialog(null);
    setRejectReason('');
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Review each mandatory document for <strong>{candidate.full_name}</strong>. All three must be verified before the offer letter can be sent.
      </p>
      {CANDIDATE_DOC_TYPES.map(t => {
        const d = docs[t.key] || { status: 'pending' };
        const sc = DOC_STATUS_CONFIG[d.status] || DOC_STATUS_CONFIG.pending;
        const StatusIcon = sc.icon;
        const files = Array.isArray(d.files) ? d.files : (d.file_url ? [{ file_url: d.file_url, filename: d.filename }] : []);
        return (
          <div key={t.key} className="border rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="font-medium text-sm">{t.label}</p>
                {files.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {files.map((f, i) => (
                      <a key={i} href={f.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">{f.filename || `File ${i + 1}`}</a>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-400 mt-1">Not submitted yet</p>}
                {d.status === 'rejected' && d.rejection_reason && (
                  <p className="text-xs text-red-600 mt-1">Reason: {d.rejection_reason}</p>
                )}
                {d.status === 'verified' && d.verified_by_name && (
                  <p className="text-xs text-gray-400 mt-1">Verified by {d.verified_by_name} · {d.verified_at ? safeDate(d.verified_at, 'dd MMM yyyy') : ''}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge className={sc.color + ' flex items-center gap-1'}><StatusIcon className="w-3 h-3" />{sc.label}</Badge>
                {files.length > 0 && d.status !== 'verified' && (
                  <>
                    <Button size="sm" variant="outline" disabled={busyKey === t.key} onClick={() => act(t.key, 'verified')} className="border-green-300 text-green-700 hover:bg-green-50">
                      {busyKey === t.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Verify
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyKey === t.key} onClick={() => setRejectDialog({ docKey: t.key, label: t.label })} className="border-red-300 text-red-700 hover:bg-red-50">
                      <XCircle className="w-3 h-3 mr-1" />Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {rejectDialog && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
          <Label className="text-xs">Reason for rejecting "{rejectDialog.label}" *</Label>
          <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} placeholder="e.g. document is blurry, name mismatch..." />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setRejectDialog(null); setRejectReason(''); }}>Cancel</Button>
            <Button size="sm" disabled={!rejectReason.trim() || busyKey} onClick={() => act(rejectDialog.docKey, 'rejected', rejectReason.trim())} className="bg-red-600 hover:bg-red-700 text-white">
              Confirm Rejection
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export default function OfferLetters() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogCandidate, setDialogCandidate] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [profileCandidate, setProfileCandidate] = useState(null);
  const isHr = (r) => ['hr', 'admin'].includes(r);
  const [role, setRole] = useState('');
  useEffect(() => { base44.auth.me().then(u => setRole(u?.custom_role || u?.role || '')).catch(() => {}); }, []);
  const [docDialogCandidate, setDocDialogCandidate] = useState(null);
  const [sendingDocReqId, setSendingDocReqId] = useState(null);
  const [downloadingConsentId, setDownloadingConsentId] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.Candidate.list('-created_date', 500);
      const relevant = all.filter(c =>
        ['selected', 'interview_done', 'offered', 'offer_accepted', 'offer_declined', 'joined'].includes(c.status)
      );
      setCandidates(relevant);
      return relevant;
    } catch (e) { toast.error('Failed to load data'); return []; }
    finally { setLoading(false); }
  };

  const handleMarkDeclined = async (c) => {
    if (!confirm(`Mark offer for ${c.full_name} as declined by candidate?`)) return;
    try {
      await base44.functions.invoke('of_mark_declined', { candidate_id: c.id });
      toast.success('Offer marked as declined');
      loadData();
    } catch (e) { toast.error(e.message); }
  };

  const handleSendDocRequest = async (c) => {
    setSendingDocReqId(c.id);
    try {
      const res = await base44.functions.invoke('sendCandidateDocRequest', { candidate_id: c.id });
      if (res.data?.success) { toast.success('Document request sent to ' + c.email); loadData(); }
      else toast.error(res.data?.error || 'Failed to send document request');
    } catch (e) { toast.error(e.message); }
    setSendingDocReqId(null);
  };

  const handleDownloadConsent = async (c) => {
    setDownloadingConsentId(c.id);
    try {
      const res = await base44.functions.invoke('getCandidateConsentPdf', { candidate_id: c.id });
      if (res.data?.success) {
        if (res.data.url) {
          // Anchor click, not window.open() — reliable even after an await
          // (see openPdfBlob's comment in utils/letterhead.js for why).
          const a = document.createElement('a'); a.href = res.data.url; a.target = '_blank'; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } else {
          openPdfBlob(res.data.base64, res.data.filename, { download: true });
        }
      } else toast.error(res.data?.error || 'Consent form not available');
    } catch (e) { toast.error(e.message); }
    setDownloadingConsentId(null);
  };

  const copyAcceptLink = (c) => {
    const base = 'https://maxone.maxvoltenergy.com';
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
    return matchSearch && matchStatus && (sourceFilter === 'all' || sourceOf(c) === sourceFilter);
  });

  const stats = {
    total: candidates.length,
    sent: candidates.filter(c => c.status === 'offered').length,
    accepted: candidates.filter(c => c.status === 'offer_accepted').length,
    declined: candidates.filter(c => c.status === 'offer_declined').length,
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
          <div className="flex gap-2">
            {isHr(role) && (
              <Button onClick={() => setCreating(true)} size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                <FileText className="w-4 h-4" /> Direct offer letter
              </Button>
            )}
            <Button onClick={loadData} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
          </div>
        </div>

        <Tabs defaultValue="candidates" className="space-y-4">
        <TabsList><TabsTrigger value="candidates">Candidates</TabsTrigger><TabsTrigger value="register">Offer register</TabsTrigger></TabsList>
        <TabsContent value="register"><OfferRegister /></TabsContent>
        <TabsContent value="candidates" className="space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total',          value: stats.total,        color: 'text-gray-700',    bg: 'bg-gray-100',    filter: 'all' },
            { label: 'Offer Sent',     value: stats.sent,         color: 'text-teal-700',    bg: 'bg-teal-100',    filter: 'offered' },
            { label: 'Accepted',       value: stats.accepted,     color: 'text-emerald-700', bg: 'bg-emerald-100', filter: 'offer_accepted' },
            { label: 'Declined',       value: stats.declined,     color: 'text-red-700',     bg: 'bg-red-100',     filter: 'offer_declined' },
            { label: 'Joined',         value: stats.joined,       color: 'text-green-700',   bg: 'bg-green-100',   filter: 'joined' },
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
                    <SelectItem value="offer_declined">Declined</SelectItem>
                    <SelectItem value="joined">Joined</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <Label className="text-xs">Source</Label>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="mrf">MRF</SelectItem>
                    <SelectItem value="recruitment">Recruitment</SelectItem>
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
                <p className="text-sm mt-1">Select candidates in Recruitment, or create a direct offer letter</p>
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
                            <Badge className={SOURCE_BADGE[sourceOf(c)][1]}>{SOURCE_BADGE[sourceOf(c)][0]}</Badge>
                            {c.employee_user_id && <Badge className="bg-green-100 text-green-800">Employee {c.employee_code || 'linked'}</Badge>}
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
                              <span>Joining: <strong>{c.joining_date ? safeDate(c.joining_date, 'dd MMM yyyy') : '—'}</strong></span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3 h-3 text-gray-400" />
                              <span>CTC: <strong>₹{fmt(ctc)}/yr</strong></span>
                            </div>
                          </div>

                          {c.offer_accepted_at && (
                            <p className="text-xs text-emerald-600">
                              Accepted on {safeDate(c.offer_accepted_at, 'dd MMM yyyy, hh:mm a')}
                              {c.offer_parent_name && ` · S/D of ${c.offer_parent_name}`}
                              {c.offer_contact && ` · ${c.offer_contact}`}
                            </p>
                          )}
                          {c.offer_letter_date && c.status === 'offered' && (
                            <p className="text-xs text-teal-600">
                              Offer sent on {safeDate(c.offer_letter_date, 'dd MMM yyyy')}
                              {c.offer_valid_till && ` · Valid till ${safeDate(c.offer_valid_till, 'dd MMM yyyy')}`}
                            </p>
                          )}
                          {c.offer_ref && (
                            <p className="text-xs text-gray-400">Ref: {c.offer_ref}</p>
                          )}
                        </div>

                        {/* Right: Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          {/* Document collection — must happen, and be verified, before an offer can go out */}
                          {c.status !== 'offered' && c.status !== 'offer_accepted' && c.status !== 'offer_declined' && c.status !== 'joined' && (
                            !c.doc_collection_sent_at ? (
                              <Button size="sm" variant="outline" onClick={() => handleSendDocRequest(c)} disabled={sendingDocReqId === c.id}
                                className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                                {sendingDocReqId === c.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                                Send Document Request
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setDocDialogCandidate(c)}
                                className={c.doc_collection_status === 'verified' ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}>
                                {c.doc_collection_status === 'verified' ? <ShieldCheck className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                                Review Documents
                                {c.doc_collection_status && c.doc_collection_status !== 'verified' && (
                                  <span className="ml-1 capitalize">({c.doc_collection_status.replace('_', ' ')})</span>
                                )}
                              </Button>
                            )
                          )}

                          {/* Opens the offer builder. Sending before the documents are verified needs an HR/admin
                              reason, enforced by the server (sendOfferLetter). */}
                          {(sourceOf(c) !== 'direct' || isHr(role)) && <Button
                            size="sm"
                            variant={c.status === 'offered' ? 'outline' : 'default'}
                            onClick={() => setDialogCandidate(c)}
                            className={c.status === 'offered' ? 'border-teal-300 text-teal-700 hover:bg-teal-50' : 'bg-green-600 hover:bg-green-700 text-white'}
                          >
                            {c.status === 'offered'
                              ? <><RefreshCw className="w-3 h-3 mr-1" /> Resend Offer</>
                              : <><Send className="w-3 h-3 mr-1" /> Offer Letter</>
                            }
                          </Button>}

                          {/* Copy acceptance link */}
                          {c.status === 'offered' && c.offer_accept_token && (
                            <Button size="sm" variant="outline" onClick={() => copyAcceptLink(c)} className="text-xs">
                              <Copy className="w-3 h-3 mr-1" /> Copy Link
                            </Button>
                          )}

                          {/* Mark offer as declined by candidate */}
                          {c.status === 'offered' && (
                            <Button size="sm" variant="outline" onClick={() => handleMarkDeclined(c)}
                              className="text-xs border-red-200 text-red-600 hover:bg-red-50">
                              <XCircle className="w-3 h-3 mr-1" /> Mark Declined
                            </Button>
                          )}

                          {/* Create the employee profile from the offer, or link the one that exists */}
                          {(c.status === 'offer_accepted' || c.status === 'joined') && (
                            <Button size="sm" onClick={() => setProfileCandidate(c)} className="bg-purple-600 hover:bg-purple-700 text-white">
                              <User className="w-3 h-3 mr-1" /> Employee profile
                            </Button>
                          )}

                          {/* Download the actual signed-and-submitted consent PDF
                              (candidate details + digitally drawn signature +
                              submission timestamp) for accepted/joined candidates */}
                          {(c.status === 'offer_accepted' || c.status === 'joined') && c.consent_signed_at && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadConsent(c)}
                              disabled={downloadingConsentId === c.id}
                              className="border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              {downloadingConsentId === c.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                              Download Signed Consent
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

        </TabsContent>
        </Tabs>
      </div>

      {/* Send/Resend Dialog */}
      <Dialog open={!!dialogCandidate} onOpenChange={open => { if (!open) setDialogCandidate(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-green-600" />
              Offer Letter — {dialogCandidate?.full_name}
            </DialogTitle>
          </DialogHeader>
          {dialogCandidate && (
            <OfferBuilder
              key={dialogCandidate.id}
              candidateId={dialogCandidate.id}
              canOverride={isHr(role)}
              onClose={() => setDialogCandidate(null)}
              onRefresh={loadData}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Direct offer: the same form, starting empty */}
      <Dialog open={creating} onOpenChange={open => { if (!open) setCreating(false); }}>
        <DialogContent className="max-w-3xl" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileCheck className="w-5 h-5 text-green-600" />Direct offer letter</DialogTitle>
          </DialogHeader>
          {creating && <OfferBuilder canOverride={isHr(role)} onClose={() => setCreating(false)} onRefresh={loadData} />}
        </DialogContent>
      </Dialog>

      <EmployeeProfileDialog candidate={profileCandidate} onClose={() => setProfileCandidate(null)} onDone={loadData} />

      {/* Document Review Dialog */}
      <Dialog open={!!docDialogCandidate} onOpenChange={open => { if (!open) setDocDialogCandidate(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Document Review — {docDialogCandidate?.full_name}
            </DialogTitle>
          </DialogHeader>
          {docDialogCandidate && (
            <CandidateDocReviewDialog
              candidate={docDialogCandidate}
              onClose={() => setDocDialogCandidate(null)}
              onRefresh={async () => {
                const fresh = await loadData();
                const updated = fresh.find(c => c.id === docDialogCandidate.id);
                if (updated) setDocDialogCandidate(updated);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
