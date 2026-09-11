import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Loader2, AlertCircle, CheckCircle2, Circle, XCircle, Briefcase, Calendar,
} from 'lucide-react';

// Public, token-based — a candidate can check their own application status
// without a login. Same shell/pattern as CandidateDocumentPortal.jsx, but
// read-only: there was previously no way for a candidate to know where
// their application stood short of emailing HR directly.
const STAGE_STEPS = [
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'interview_scheduled', label: 'Interview' },
  { key: 'selected', label: 'Selected' },
  { key: 'offered', label: 'Offer' },
  { key: 'joined', label: 'Joined' },
];

export default function ApplicationStatusPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    base44.functions.invoke('getApplicationStatus', { token }).then(res => {
      if (res.data?.success) {
        setStatus(res.data.status);
      } else {
        setError(res.data?.error || 'Application not found.');
      }
      setLoading(false);
    }).catch(() => { setError('Failed to load. Please try again.'); setLoading(false); });
  }, [token]);

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

  const isRejected = status.is_rejected;
  const currentIdx = STAGE_STEPS.findIndex(s => s.key === status.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <img src="/favicon.svg?v=6" alt="Maxvolt Energy" className="h-10 object-contain" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">Maxvolt Energy Industries Limited</h1>
            <p className="text-xs text-gray-500">Application Status</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Hello, {status.full_name}</h2>
          <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-1">
            <Briefcase className="w-4 h-4" /> {status.position_applied || 'Position not specified'}
            {status.department && <span className="text-gray-400">· {status.department}</span>}
          </p>
          {status.applied_date && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-1">
              <Calendar className="w-3.5 h-3.5" /> Applied {new Date(status.applied_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>

        {isRejected ? (
          <div className="bg-white rounded-2xl shadow-sm border p-6 text-center">
            <XCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-700">{status.status_label}</p>
            <p className="text-sm text-gray-500 mt-2">
              Thank you for your interest — we've decided to move forward with other candidates for this specific role.
              We encourage you to apply for future openings that match your profile.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border p-6">
            <p className="text-sm font-semibold text-gray-700 mb-5">Current Status: <span className="text-orange-600">{status.status_label}</span></p>
            <div className="flex items-start">
              {STAGE_STEPS.map((step, i) => {
                const done = currentIdx >= 0 && i <= currentIdx;
                const isCurrent = i === currentIdx;
                return (
                  <React.Fragment key={step.key}>
                    <div className="flex flex-col items-center flex-1 min-w-0">
                      {done ? (
                        <CheckCircle2 className={`w-6 h-6 flex-shrink-0 ${isCurrent ? 'text-orange-500' : 'text-green-500'}`} />
                      ) : (
                        <Circle className="w-6 h-6 text-gray-200 flex-shrink-0" />
                      )}
                      <span className={`text-[11px] mt-1.5 text-center leading-tight ${done ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>{step.label}</span>
                    </div>
                    {i < STAGE_STEPS.length - 1 && (
                      <div className={`h-0.5 flex-1 mt-3 ${i < currentIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center">
          Questions about your application? Contact us at <a href="mailto:hr@maxvoltenergy.com" className="text-orange-600">hr@maxvoltenergy.com</a>
        </p>
      </div>

      <footer className="text-center py-6 text-xs text-gray-400 border-t mt-8">
        Maxvolt Energy Industries Limited · E-82 Bulandshahr Road Industrial Area, Ghaziabad, UP – 201009
      </footer>
    </div>
  );
}
