import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

// One-time, revocable consent before this app sends any personal data to
// Groq (the third-party AI service behind every AI-labeled feature — see
// backend/utils/ai.js) — required by App Store guideline 5.1.1(i)/5.1.2(i):
// disclose what's sent, name who it's sent to, and get real permission
// first, not just a privacy-policy mention. Enforcement is server-side
// (requireAiConsent in functions.js, on every AI-calling case) — this modal
// is the UI for granting/declining that, not the actual gate; a user who
// dismisses it can still use every non-AI feature normally.
const NOT_NOW_KEY = 'ai_consent_prompted_v1';

export default function AiConsentModal() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await base44.functions.invoke('getAiConsentStatus', {});
        const given = res.data?.consent_given;
        if (cancelled) return;
        if (!given) {
          // Only auto-open once per browser on a normal page load — but the
          // 'ai-consent-required' listener below still reopens it any time
          // the user actually tries to use an AI feature after dismissing.
          let alreadyPrompted = false;
          try { alreadyPrompted = localStorage.getItem(NOT_NOW_KEY) === '1'; } catch { /* private mode etc. */ }
          if (!alreadyPrompted) setOpen(true);
        }
      } catch { /* not logged in yet, or request failed — silently skip */ }
    };
    check();

    // Fired by base44Client.js the moment ANY AI-powered call gets rejected
    // for missing consent — reopens the ask right in the moment it matters,
    // regardless of the "don't auto-nag" flag above.
    const onRequired = () => setOpen(true);
    window.addEventListener('ai-consent-required', onRequired);
    return () => { cancelled = true; window.removeEventListener('ai-consent-required', onRequired); };
  }, []);

  const markPrompted = () => { try { localStorage.setItem(NOT_NOW_KEY, '1'); } catch { /* ignore */ } };

  const handleAccept = async () => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke('setAiConsent', { consent: true });
      if (res.data?.success) {
        toast.success('AI Features enabled');
        markPrompted();
        setOpen(false);
      } else {
        toast.error('Failed to save — please try again from App Settings');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to save');
    }
    setSaving(false);
  };

  const handleDecline = () => {
    markPrompted();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      {/* max-h + flex-col with only the middle section scrolling — on a
          short mobile screen (especially landscape, or with the on-screen
          keyboard eating vertical space) the disclosure text + bullet list
          was taller than the viewport with no way to reach the Accept/
          Decline buttons at all, since the card had no height cap. Header
          and footer buttons stay pinned; only the body scrolls. */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-5 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Enable AI Features?</h2>
              <p className="text-xs text-white/80 mt-0.5">Powered by Groq — a third-party AI service</p>
            </div>
          </div>
          <button onClick={handleDecline} className="text-white/70 hover:text-white flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-sm text-gray-700">
            Maxvolt One uses <strong>Groq</strong>, a third-party AI service, to power features like{' '}
            <strong>AskMax AI Assistant</strong>, resume screening, AI-generated HR letters, and HR
            insights/summaries. When you use one of these features, relevant data is sent to Groq for
            processing:
          </p>
          <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1.5">
            <li><strong>AskMax AI Assistant</strong> — your question, and HR data needed to answer it (e.g. your leave balance, attendance, or team records you're authorized to see).</li>
            <li><strong>Resume screening / candidate scoring</strong> (HR &amp; recruiters) — a candidate's resume text and profile details.</li>
            <li><strong>AI-generated HR letters</strong> — the employee's name, code, designation, and department.</li>
            <li><strong>HR insights, digests &amp; retention plans</strong> — aggregated or individual workforce data relevant to the request.</li>
          </ul>
          <p className="text-xs text-gray-400">
            Groq processes this data only to generate the response for that feature and does not use it for
            advertising. You can change this choice at any time from <strong>App Settings → AI Features</strong>.
            Declining only disables AI-labeled features — everything else in the app works normally.
          </p>
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-1 flex-shrink-0 border-t border-gray-100">
          <button
            onClick={handleDecline}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            Not Now
          </button>
          <button
            onClick={handleAccept}
            disabled={saving}
            className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Enable AI Features'}
          </button>
        </div>
      </div>
    </div>
  );
}
