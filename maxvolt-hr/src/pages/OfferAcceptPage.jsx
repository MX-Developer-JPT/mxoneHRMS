import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, FileText, Building2, Calendar, MapPin, User, AlertCircle } from 'lucide-react';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

export default function OfferAcceptPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: '', parent_name: '', contact_no: '', agreed: false });

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    base44.functions.invoke('getOfferByToken', { token }).then(res => {
      if (res.data?.offer) {
        setOffer(res.data.offer);
        setForm(f => ({ ...f, full_name: res.data.offer.full_name || '' }));
      } else {
        setError(res.data?.error || 'Offer not found or link has expired.');
      }
      setLoading(false);
    }).catch(() => { setError('Failed to load offer. Please try again.'); setLoading(false); });
  }, [token]);

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.parent_name || !form.contact_no) {
      toast.error('Please fill in all required fields.'); return;
    }
    if (!form.agreed) {
      toast.error('Please agree to the consent form before accepting.'); return;
    }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('acceptOfferLetter', {
        token,
        full_name: form.full_name,
        parent_name: form.parent_name,
        contact_no: form.contact_no,
      });
      if (res.data?.success) {
        setAccepted(true);
      } else {
        toast.error(res.data?.error || 'Failed to submit acceptance.');
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

  if (accepted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Offer Accepted!</h2>
        <p className="text-gray-600 mb-4">
          Thank you, <strong>{form.full_name}</strong>! You have successfully accepted the offer from
          Maxvolt Energy Industries Limited.
        </p>
        <p className="text-gray-500 text-sm">
          Our HR team has been notified and will reach out to you with next steps. We look forward to
          welcoming you aboard!
        </p>
        <div className="mt-6 p-4 bg-orange-50 rounded-xl text-sm text-orange-800">
          Your joining date: <strong>{offer?.joining_date ? new Date(offer.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}</strong>
        </div>
      </div>
    </div>
  );

  const sal = offer?.salary || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <img src="/favicon.svg" alt="Maxvolt Energy" className="h-10 object-contain" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">Maxvolt Energy Industries Limited</h1>
            <p className="text-xs text-gray-500">Offer Letter Acceptance Portal</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Offer Summary */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-orange-100 rounded-xl">
              <FileText className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Offer of Employment</h2>
              <p className="text-sm text-gray-500">Ref: {offer?.offer_ref}</p>
            </div>
          </div>

          <div className="text-sm text-gray-700 mb-4">
            <p className="font-medium text-lg mb-1">Dear {offer?.full_name},</p>
            <p>Congratulations! We are pleased to offer you the following position at Maxvolt Energy Industries Limited.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {[
              [User, 'Designation', offer?.designation],
              [Building2, 'Department', offer?.department],
              [MapPin, 'Work Location', offer?.location],
              [Calendar, 'Date of Joining', offer?.joining_date ? new Date(offer.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'],
              [User, 'Reporting To', offer?.reporting_to],
              [FileText, 'Probation Period', `${offer?.probation_months || 6} months`],
            ].map(([Icon, label, value]) => (
              <div key={label} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="font-medium text-gray-900">{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Salary Structure */}
        {sal.annual_ctc > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <h3 className="font-bold text-gray-900 mb-4 text-base">Break-up of Salary Components</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 border font-semibold text-gray-700">Salary Head</th>
                    <th className="text-right p-3 border font-semibold text-gray-700">Annually (₹)</th>
                    <th className="text-right p-3 border font-semibold text-gray-700">Monthly (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={3} className="p-2 border bg-gray-50 font-semibold text-gray-600 text-xs uppercase">Earnings</td></tr>
                  {[
                    ['Basic', sal.basic_annual, sal.basic_monthly],
                    ['HRA', sal.hra_annual, sal.hra_monthly],
                    ['Conveyance', sal.conveyance_annual, sal.conveyance_monthly],
                    ['LTA', sal.lta_annual, sal.lta_monthly],
                    ['Special Allowance', sal.special_annual, sal.special_monthly],
                  ].map(([label, ann, mon]) => (
                    <tr key={label} className="hover:bg-gray-50">
                      <td className="p-3 border">{label}</td>
                      <td className="p-3 border text-right">{fmt(ann)}</td>
                      <td className="p-3 border text-right">{fmt(mon)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-semibold">
                    <td className="p-3 border">Total Gross (A)</td>
                    <td className="p-3 border text-right">{fmt(sal.gross_annual)}</td>
                    <td className="p-3 border text-right">{fmt(sal.gross_monthly)}</td>
                  </tr>
                  <tr><td colSpan={3} className="p-2 border bg-gray-50 font-semibold text-gray-600 text-xs uppercase">Deductions</td></tr>
                  {[
                    ['PF Employee Contribution', sal.pf_emp_annual, sal.pf_emp_monthly],
                    ['ESI Employee Contribution', 0, 0],
                  ].map(([label, ann, mon]) => (
                    <tr key={label} className="hover:bg-gray-50">
                      <td className="p-3 border">{label}</td>
                      <td className="p-3 border text-right">{ann ? fmt(ann) : '—'}</td>
                      <td className="p-3 border text-right">{mon ? fmt(mon) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-red-50 font-semibold">
                    <td className="p-3 border">Total Deduction (B)</td>
                    <td className="p-3 border text-right">{fmt(sal.pf_emp_annual)}</td>
                    <td className="p-3 border text-right">{fmt(sal.pf_emp_monthly)}</td>
                  </tr>
                  <tr className="bg-green-50 font-bold">
                    <td className="p-3 border">Total Net Salary (A-B)</td>
                    <td className="p-3 border text-right">{fmt(sal.net_annual)}</td>
                    <td className="p-3 border text-right">{fmt(sal.net_monthly)}</td>
                  </tr>
                  <tr><td colSpan={3} className="p-2 border bg-gray-50 font-semibold text-gray-600 text-xs uppercase">Employer Contributions</td></tr>
                  {[
                    ['PF Employer Contribution', sal.pf_employer_annual, sal.pf_employer_monthly],
                    ['Medical', sal.medical_annual, sal.medical_monthly],
                    ['Bonus', sal.bonus_annual, sal.bonus_monthly],
                  ].map(([label, ann, mon]) => (
                    <tr key={label} className="hover:bg-gray-50">
                      <td className="p-3 border">{label}</td>
                      <td className="p-3 border text-right">{fmt(ann)}</td>
                      <td className="p-3 border text-right">{fmt(mon)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-gray-50">
                    <td className="p-3 border">Total Contribution (C)</td>
                    <td className="p-3 border text-right">{fmt(sal.contribution_annual)}</td>
                    <td className="p-3 border text-right">{fmt(sal.contribution_monthly)}</td>
                  </tr>
                  <tr className="bg-orange-50 font-bold text-orange-900">
                    <td className="p-3 border">Annual CTC (A+C)</td>
                    <td className="p-3 border text-right">{fmt(sal.annual_ctc)}</td>
                    <td className="p-3 border text-right">{fmt(sal.monthly_ctc)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Documents to submit at joining */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h3 className="font-bold text-gray-900 mb-3 text-base">Documents Required at Joining</h3>
          <ul className="space-y-1.5 text-sm text-gray-700">
            {[
              'Proof of address & ID (Local & Permanent)',
              'Five color recent passport-size photos (not older than 3 months)',
              'Photocopies of 10th, 12th certificate & highest degree certificates',
              'Offer, Appointment & Increment Letters (last 3)',
              'Proof of work experience – Experience/Relieving letter (last 3)',
              'Last 3 months salary slips & 6 months bank statement',
            ].map(item => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Consent Form */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h3 className="font-bold text-gray-900 mb-3 text-base">Consent Form for Background Verification Services</h3>
          <div className="text-sm text-gray-700 space-y-3">
            <p>
              I hereby authorize <strong>MaxVolt Energy Industries Limited</strong> and its associates to conduct a
              comprehensive background verification based on the documentation and information provided by me.
            </p>
            <p>
              I understand that the scope of the background verification check may include, but is not limited to:
              authentication of government documents, address verification, education qualification, past employment
              checks, reference checks, criminal records check, credit history and reference checks.
            </p>
            <p>
              Further, I authorize any individual, company, firm, corporation, or public agency to divulge any and
              all information, verbal or written, pertaining to me as is required to complete the background
              verification report.
            </p>
            <p>
              I confirm that I will not hold MaxVolt Energy Industries Limited and its associates liable for any
              direct or indirect loss/damage, whether financial or non-financial, incurred by me due to the
              verifications conducted.
            </p>
          </div>
        </div>

        {/* Acceptance Form */}
        <form onSubmit={handleAccept} className="bg-white rounded-2xl shadow-sm border p-6 space-y-5">
          <h3 className="font-bold text-gray-900 text-base">Accept This Offer</h3>
          <p className="text-sm text-gray-500">
            Please fill in the details below and agree to the consent form to formally accept this offer.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Your Full Name *</Label>
              <Input
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="As per government ID"
                required
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Father's / Mother's Name *</Label>
              <Input
                value={form.parent_name}
                onChange={e => setForm(f => ({ ...f, parent_name: e.target.value }))}
                placeholder="Son/Daughter of..."
                required
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-sm font-medium">Contact Number *</Label>
              <Input
                type="tel"
                value={form.contact_no}
                onChange={e => setForm(f => ({ ...f, contact_no: e.target.value }))}
                placeholder="+91 XXXXXXXXXX"
                required
                className="mt-1"
              />
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.agreed}
              onChange={e => setForm(f => ({ ...f, agreed: e.target.checked }))}
              className="mt-1 w-4 h-4 accent-orange-500"
            />
            <span className="text-sm text-gray-700">
              I, <strong>{form.full_name || '___'}</strong>, Son/Daughter of <strong>{form.parent_name || '___'}</strong>,
              have read and agree to all the terms and conditions of this offer letter and authorize Maxvolt Energy
              Industries Limited to conduct a background verification as per the consent form above.
            </span>
          </label>

          <Button
            type="submit"
            disabled={submitting || !form.agreed}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3 text-base font-semibold"
          >
            {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...</> : 'Accept Offer Letter'}
          </Button>

          <p className="text-xs text-center text-gray-400">
            By clicking Accept, you are electronically signing this offer. This is a legally binding acceptance.
          </p>
        </form>
      </div>

      <footer className="text-center py-6 text-xs text-gray-400 border-t mt-8">
        Maxvolt Energy Industries Limited · E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009 ·
        CIN: U40106DL2019PLC349854
      </footer>
    </div>
  );
}
