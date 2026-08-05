import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, FileText, Mail, Phone, Building2, Briefcase, DollarSign, Clock, Bell, X } from 'lucide-react';
import { Textarea } from "@/components/ui/textarea";
import { toast } from 'sonner';
import ResumeParsePanel from './ResumeParsePanel';
import CvViewerModal from './CvViewerModal';

export default function CandidateDetailDialog({ candidate, open, onClose, onCandidateUpdated }) {
  const [aiResult, setAiResult] = useState(null);
  const [scoring, setScoring] = useState(false);
  const [localCandidate, setLocalCandidate] = useState(candidate);
  const [showCv, setShowCv] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [remindAt, setRemindAt] = useState('');
  const [remindNote, setRemindNote] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);

  useEffect(() => { setLocalCandidate(candidate); setAiResult(null); setShowReminderForm(false); if (candidate?.id) loadReminders(candidate.id); }, [candidate]);

  const loadReminders = async (candidateId) => {
    try {
      const res = await base44.functions.invoke('getCandidateReminders', { candidate_id: candidateId });
      setReminders((res.data?.reminders || []).filter(r => r.status === 'pending'));
    } catch { setReminders([]); }
  };

  const handleSetReminder = async () => {
    if (!remindAt) { toast.error('Pick a date and time'); return; }
    setSavingReminder(true);
    try {
      const res = await base44.functions.invoke('setCandidateReminder', {
        candidate_id: localCandidate.id,
        remind_at: new Date(remindAt).toISOString(),
        note: remindNote,
      });
      if (res.data?.success) {
        toast.success('Reminder set');
        setShowReminderForm(false); setRemindAt(''); setRemindNote('');
        loadReminders(localCandidate.id);
      } else {
        toast.error(res.data?.error || 'Failed to set reminder');
      }
    } catch (e) { toast.error(e.message); }
    setSavingReminder(false);
  };

  const handleCancelReminder = async (reminderId) => {
    try {
      await base44.functions.invoke('cancelCandidateReminder', { reminder_id: reminderId });
      loadReminders(localCandidate.id);
    } catch (e) { toast.error(e.message); }
  };

  if (!localCandidate) return null;

  const handleAIScore = async () => {
    if (!localCandidate.resume_url) return;
    setScoring(true);
    setAiResult(null);
    try {
      const res = await base44.functions.invoke('scoreAndSummariseCv', {
        candidate_id: localCandidate.id,
        resume_url: localCandidate.resume_url,
        position_applied: localCandidate.position_applied,
        department: localCandidate.department,
        experience_years: localCandidate.experience_years,
        current_company: localCandidate.current_company,
        current_ctc: localCandidate.current_ctc,
        expected_ctc: localCandidate.expected_ctc,
        notice_period: localCandidate.notice_period,
        source: localCandidate.source,
      });
      if (res.data?.success) {
        setAiResult(res.data.result);
      } else {
        setAiResult({ error: res.data?.error || 'Analysis failed' });
      }
    } catch (e) {
      setAiResult({ error: e.message });
    }
    setScoring(false);
  };

  const scoreColor = (score) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const recoBadge = (rec) => {
    if (!rec) return 'bg-gray-100 text-gray-700';
    const r = rec.toLowerCase();
    if (r.includes('strongly')) return 'bg-green-100 text-green-800';
    if (r.includes('recommend') && !r.includes('not')) return 'bg-blue-100 text-blue-800';
    if (r.includes('maybe')) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                {localCandidate.full_name?.charAt(0).toUpperCase()}
              </div>
              {localCandidate.full_name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Applied position — most important context, shown up top */}
            <div className="flex items-center gap-3 flex-wrap bg-blue-50 rounded-lg px-3 py-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700">
                <Briefcase className="w-4 h-4" /> {localCandidate.position_applied || 'Position not specified'}
              </span>
              {localCandidate.department && (
                <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                  <Building2 className="w-4 h-4" /> {localCandidate.department}
                </span>
              )}
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600 min-w-0"><Mail className="w-4 h-4 flex-shrink-0" /><span className="truncate">{localCandidate.email}</span></div>
              <div className="flex items-center gap-2 text-gray-600 min-w-0"><Phone className="w-4 h-4 flex-shrink-0" /><span className="truncate">{localCandidate.phone}</span></div>
              {localCandidate.current_company && <div className="flex items-center gap-2 text-gray-600 min-w-0"><FileText className="w-4 h-4 flex-shrink-0" /><span className="truncate">Current: {localCandidate.current_company}</span></div>}
              <div className="flex items-center gap-2 text-gray-600 min-w-0"><Clock className="w-4 h-4 flex-shrink-0" /><span className="truncate">{localCandidate.experience_years} yrs exp · {localCandidate.notice_period || 0} days notice</span></div>
              <div className="flex items-center gap-2 text-gray-600 min-w-0"><DollarSign className="w-4 h-4 flex-shrink-0" /><span className="truncate">Expected: ₹{localCandidate.expected_ctc?.toLocaleString() || '—'}</span></div>
            </div>

            {/* CV Actions */}
            <div className="flex gap-3 pt-1 border-t flex-wrap">
              {localCandidate.resume_url ? (
                <Button variant="outline" size="sm" onClick={() => setShowCv(true)}>
                  <FileText className="w-4 h-4 mr-2" /> View CV
                </Button>
              ) : (
                <span className="text-sm text-gray-400 italic">No CV uploaded</span>
              )}
              {localCandidate.resume_url && (
                <Button size="sm" onClick={handleAIScore} disabled={scoring} className="bg-purple-600 hover:bg-purple-700">
                  {scoring ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analysing...</> : <><Sparkles className="w-4 h-4 mr-2" />AI Score CV</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowReminderForm(v => !v)}>
                <Bell className="w-4 h-4 mr-2" /> Remind
              </Button>
            </div>

            {/* Reminder form + list */}
            {showReminderForm && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={e => setRemindAt(e.target.value)}
                  className="w-full text-sm border rounded-md px-2 py-1.5"
                />
                <Textarea placeholder="What should this reminder say? (optional)" rows={2} value={remindNote} onChange={e => setRemindNote(e.target.value)} className="text-sm" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSetReminder} disabled={savingReminder}>
                    {savingReminder ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Bell className="w-3.5 h-3.5 mr-1.5" />} Set Reminder
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowReminderForm(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {reminders.length > 0 && (
              <div className="space-y-1.5">
                {reminders.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-amber-800 min-w-0">
                      <Bell className="w-3 h-3 flex-shrink-0" />
                      <span className="font-medium flex-shrink-0">{new Date(r.remind_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                      {r.note && <span className="text-amber-600 truncate">— {r.note}</span>}
                    </div>
                    <button onClick={() => handleCancelReminder(r.id)} className="text-amber-400 hover:text-amber-700 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Resume Parse Panel */}
            <ResumeParsePanel
              candidate={localCandidate}
              onParsed={(data) => {
                setLocalCandidate(prev => ({ ...prev, parsed_resume_id: data.parsed_resume_id, resume_parsed: true }));
                if (onCandidateUpdated) onCandidateUpdated();
              }}
            />

            {/* AI Result */}
            {aiResult && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-3 border">
                {aiResult.error ? (
                  <p className="text-red-600 text-sm">Error: {aiResult.error}</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-gray-800 flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-600" />AI Analysis</h4>
                      <div className="flex items-center gap-3">
                        <span className={`text-3xl font-bold ${scoreColor(aiResult.score)}`}>{aiResult.score}<span className="text-base font-normal text-gray-400">/100</span></span>
                        <Badge className={recoBadge(aiResult.recommendation)}>{aiResult.recommendation}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700">{aiResult.summary}</p>
                    {aiResult.strengths?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-green-700 uppercase mb-1">Strengths</p>
                        <ul className="space-y-1">
                          {aiResult.strengths.map((s, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-green-500 mt-0.5">✓</span>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {aiResult.concerns?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-red-700 uppercase mb-1">Concerns</p>
                        <ul className="space-y-1">
                          {aiResult.concerns.map((c, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-red-400 mt-0.5">!</span>{c}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CvViewerModal
        open={showCv}
        onClose={() => setShowCv(false)}
        resumeUrl={localCandidate.resume_url}
        candidateName={localCandidate.full_name}
      />
    </>
  );
}