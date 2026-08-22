import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  CheckCircle2, Loader2, FileText, AlertCircle, Upload, Clock, XCircle, ShieldCheck, RotateCcw,
} from 'lucide-react';

const DOC_TYPES = [
  { key: 'aadhaar_card', label: 'Aadhaar Card', multi: false },
  { key: 'salary_slips', label: "Last 3 Months' Salary Slips", multi: true },
  { key: 'bank_statements', label: "Last 6 Months' Bank Statements", multi: true },
];

const STATUS_CONFIG = {
  pending:               { label: 'Pending',              color: 'bg-gray-100 text-gray-600',    icon: Clock },
  submitted:             { label: 'Submitted — Awaiting Review', color: 'bg-blue-100 text-blue-700', icon: FileText },
  verified:              { label: 'Verified',              color: 'bg-green-100 text-green-700',  icon: ShieldCheck },
  rejected:              { label: 'Requires Resubmission', color: 'bg-red-100 text-red-700',       icon: XCircle },
};

export default function CandidateDocumentPortal() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState({});
  const [pending, setPending] = useState({}); // newly selected/uploaded files, not yet submitted
  const [expectedDoj, setExpectedDoj] = useState('');
  const [hasOtherOffer, setHasOtherOffer] = useState(false);
  const [otherOffer, setOtherOffer] = useState({ company_name: '', offered_ctc: '', joining_date: '' });

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    base44.functions.invoke('getCandidateDocPortal', { token }).then(res => {
      if (res.data?.success) {
        setCandidate(res.data.candidate);
        setExpectedDoj(res.data.candidate.expected_doj || '');
        setHasOtherOffer(!!res.data.candidate.has_other_offer);
        setOtherOffer(res.data.candidate.other_offer_details || { company_name: '', offered_ctc: '', joining_date: '' });
      } else {
        setError(res.data?.error || 'Link not found or invalid.');
      }
      setLoading(false);
    }).catch(() => { setError('Failed to load. Please try again.'); setLoading(false); });
  }, [token]);

  const handleFileSelect = async (docKey, multi, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(u => ({ ...u, [docKey]: true }));
    try {
      const uploaded = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploaded.push({ file_url, filename: file.name });
      }
      setPending(p => ({
        ...p,
        [docKey]: multi
          ? { files: [...(p[docKey]?.files || []), ...uploaded] }
          : { file_url: uploaded[0].file_url, filename: uploaded[0].filename },
      }));
      toast.success(`${files.length > 1 ? `${files.length} files` : 'File'} uploaded`);
    } catch (e) {
      toast.error('Upload failed: ' + e.message);
    }
    setUploading(u => ({ ...u, [docKey]: false }));
  };

  const handleSubmit = async () => {
    const someNewUpload = DOC_TYPES.some(t => pending[t.key]);
    if (!someNewUpload && !expectedDoj) {
      toast.error('Please upload at least one document or confirm your expected date of joining.');
      return;
    }
    if (!expectedDoj) { toast.error('Please provide your expected/confirmed date of joining.'); return; }
    if (hasOtherOffer && (!otherOffer.company_name || !otherOffer.offered_ctc)) {
      toast.error('Please provide the other offer\'s company name and CTC.'); return;
    }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('submitCandidateDocuments', {
        token,
        documents: pending,
        expected_doj: expectedDoj,
        has_other_offer: hasOtherOffer,
        other_offer_details: hasOtherOffer ? otherOffer : null,
      });
      if (res.data?.success) {
        setSubmitted(true);
      } else {
        toast.error(res.data?.error || 'Submission failed.');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setSubmitting(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-2">Link Not Valid</h2>
        <p className="text-gray-500">{error}</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Documents Submitted!</h2>
        <p className="text-gray-600">
          Thank you. Our HR team will review your documents shortly. You'll be notified once your offer letter is ready.
        </p>
      </div>
    </div>
  );

  const docs = candidate?.documents || {};

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <img src="/favicon.svg?v=6" alt="Maxvolt Energy" className="h-10 object-contain" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">Maxvolt Energy Industries Limited</h1>
            <p className="text-xs text-gray-500">Document Submission Portal</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Dear {candidate?.full_name},</h2>
          <p className="text-sm text-gray-500">
            Before we can proceed with your offer for <strong>{candidate?.position_applied || 'the role'}</strong>, please submit the documents below.
          </p>
        </div>

        {DOC_TYPES.map(t => {
          const d = docs[t.key] || {};
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
          const StatusIcon = sc.icon;
          const canUpload = d.status !== 'verified';
          const newFiles = t.multi ? (pending[t.key]?.files || []) : (pending[t.key] ? [pending[t.key]] : []);
          return (
            <div key={t.key} className="bg-white rounded-2xl shadow-sm border p-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-semibold text-gray-900">{t.label}</h3>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${sc.color}`}>
                  <StatusIcon className="w-3.5 h-3.5" /> {sc.label}
                </span>
              </div>
              {d.status === 'rejected' && d.rejection_reason && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-3 flex items-start gap-2">
                  <RotateCcw className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span><strong>Resubmission needed:</strong> {d.rejection_reason}</span>
                </div>
              )}
              {t.multi && Array.isArray(d.files) && d.files.length > 0 && d.status !== 'rejected' && (
                <p className="text-xs text-gray-500 mb-2">{d.files.length} file(s) previously submitted.</p>
              )}
              {!t.multi && d.file_url && d.status !== 'rejected' && (
                <p className="text-xs text-gray-500 mb-2">Previously submitted: {d.filename || 'file'}</p>
              )}
              {newFiles.length > 0 && (
                <ul className="text-xs text-green-700 mb-2 space-y-0.5">
                  {newFiles.map((f, i) => <li key={i}>✓ {f.filename}</li>)}
                </ul>
              )}
              {canUpload && (
                <label className="cursor-pointer inline-block">
                  <input
                    type="file" className="hidden" multiple={t.multi} accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => handleFileSelect(t.key, t.multi, e.target.files)}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={uploading[t.key]} asChild>
                    <span>
                      {uploading[t.key] ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                      {d.status === 'rejected' ? 'Resubmit' : 'Upload'}
                    </span>
                  </Button>
                </label>
              )}
            </div>
          );
        })}

        <div className="bg-white rounded-2xl shadow-sm border p-6 space-y-4">
          <div>
            <Label className="text-sm font-medium">Expected / Confirmed Date of Joining *</Label>
            <Input type="date" value={expectedDoj} onChange={e => setExpectedDoj(e.target.value)} className="mt-1" required />
          </div>

          <div>
            <Label className="text-sm font-medium mb-2 block">Are you currently holding any other offer?</Label>
            <div className="flex gap-3">
              <Button type="button" variant={hasOtherOffer ? 'default' : 'outline'} size="sm" onClick={() => setHasOtherOffer(true)}>Yes</Button>
              <Button type="button" variant={!hasOtherOffer ? 'default' : 'outline'} size="sm" onClick={() => setHasOtherOffer(false)}>No</Button>
            </div>
          </div>

          {hasOtherOffer && (
            <div className="grid sm:grid-cols-3 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div>
                <Label className="text-xs">Company Name *</Label>
                <Input value={otherOffer.company_name} onChange={e => setOtherOffer(o => ({ ...o, company_name: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Offered CTC (₹) *</Label>
                <Input type="number" value={otherOffer.offered_ctc} onChange={e => setOtherOffer(o => ({ ...o, offered_ctc: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Joining Date</Label>
                <Input type="date" value={otherOffer.joining_date} onChange={e => setOtherOffer(o => ({ ...o, joining_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={submitting} className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3 text-base font-semibold">
            {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...</> : 'Submit Documents'}
          </Button>
        </div>
      </div>

      <footer className="text-center py-6 text-xs text-gray-400 border-t mt-8">
        Maxvolt Energy Industries Limited · E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009
      </footer>
    </div>
  );
}
