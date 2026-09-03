import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LifeBuoy, CheckCircle2, Loader2, Mail } from 'lucide-react';

// Public, unauthenticated support page — reachable from the Login screen
// (someone locked out of their account is exactly who needs this) and from
// inside the app (App Settings ▸ Legal). Files a request via
// submitSupportRequest, which emails both HR and the requester; doesn't try
// to resolve anything automatically, matching DeleteAccountRequest.jsx's
// existing pattern for the same class of public, no-login request forms.
export default function Support() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email address so we can get back to you.');
      return;
    }
    if (!message.trim()) {
      setError('Please describe what you need help with.');
      return;
    }
    setSubmitting(true);
    try {
      await base44.functions.invoke('submitSupportRequest', {
        name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim(),
      });
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
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <LifeBuoy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Support</h1>
            <p className="text-xs text-gray-400">Maxvolt One — Maxvolt Energy Industries Limited</p>
          </div>
        </div>

        {submitted ? (
          <div className="mt-8 text-center py-8">
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Request received</h2>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              We've emailed you a confirmation. Our team will get back to you as soon as possible.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 leading-relaxed mt-4 mb-6">
              Having trouble signing in, or need help with something in the app? Send us a message
              below and our team will get back to you — no login required.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

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
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  placeholder="What's this about?"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">How can we help? <span className="text-red-500">*</span></Label>
                <Textarea
                  id="message"
                  placeholder="Describe the issue or question you have"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
              )}

              <Button type="submit" className="w-full h-11 font-medium" disabled={submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting...</> : 'Send Request'}
              </Button>
            </form>

            <p className="text-xs text-gray-400 mt-6 text-center">
              You can also email <a href="mailto:hr@maxvoltenergy.com" className="text-indigo-600 hover:underline">hr@maxvoltenergy.com</a> directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
