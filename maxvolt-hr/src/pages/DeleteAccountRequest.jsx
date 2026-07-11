import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, CheckCircle2, Loader2, Mail } from 'lucide-react';

export default function DeleteAccountRequest() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter the email address associated with your account.');
      return;
    }
    setSubmitting(true);
    try {
      await base44.functions.invoke('requestAccountDeletion', { email: email.trim(), reason: reason.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Failed to submit your request. Please try again or email hr@maxvoltenergy.com directly.');
    }
    setSubmitting(false);
  };

  return (
    <div
      className="min-h-dvh bg-gray-50 px-4"
      style={{
        paddingTop: 'calc(2.5rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))',
      }}
    >
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-sm border p-6 md:p-10">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Delete Account &amp; Data</h1>
            <p className="text-xs text-gray-400">Maxvolt One — Maxvolt Energy Industries Limited</p>
          </div>
        </div>

        {submitted ? (
          <div className="mt-8 text-center py-8">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Request received</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              We've emailed you a confirmation. Our HR team will review and process your request,
              subject to any statutory record-retention requirements under applicable law, and will
              follow up once it's complete.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 leading-relaxed mt-4 mb-6">
              Use this form to request deletion of your Maxvolt One account and the personal data
              associated with it. Some HR records (e.g. attendance, payroll, tax filings) may be
              subject to statutory retention periods under Indian labour and tax law and cannot be
              deleted immediately — where that applies, we'll let you know what's retained and why.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address <span className="text-red-500">*</span></Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@maxvolt.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                  />
                </div>
                <p className="text-xs text-gray-400">The email address registered on your account.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Textarea
                  id="reason"
                  placeholder="Let us know why you're requesting deletion (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
              )}

              <Button type="submit" className="w-full h-11 font-medium bg-red-600 hover:bg-red-700" disabled={submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Request Deletion'}
              </Button>
            </form>

            <p className="text-xs text-gray-400 mt-6 text-center">
              You can also email <a href="mailto:hr@maxvoltenergy.com" className="text-indigo-600 hover:underline">hr@maxvoltenergy.com</a> directly.
              See our <a href="/PrivacyPolicy" className="text-indigo-600 hover:underline">Privacy Policy</a> for details on data retention.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
