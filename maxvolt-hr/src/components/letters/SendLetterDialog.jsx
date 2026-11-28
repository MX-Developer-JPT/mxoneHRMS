import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Send } from 'lucide-react';

const VALID = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[A-Za-z]{2,}$/;

// Where should this letter go: the employee's account address, or one typed by HR. The server validates it again.
export default function SendLetterDialog({ open, userId, employeeName, letterLabel, sending, onClose, onSend }) {
  const [mode, setMode] = useState('registered');
  const [email, setEmail] = useState('');
  const [registered, setRegistered] = useState(null);

  useEffect(() => {
    if (!open || !userId) return;
    setRegistered(null); setMode('registered'); setEmail('');
    base44.functions.invoke('lt_recipient', { user_id: userId })
      .then((r) => { const d = r?.data || r; setRegistered(d); if (!d.registered_email) setMode('custom'); })
      .catch(() => { setRegistered({ registered_email: '' }); setMode('custom'); });
  }, [open, userId]);

  const custom = email.trim();
  const ready = mode === 'registered' ? !!registered?.registered_email : VALID.test(custom);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Send {letterLabel} to {employeeName}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className={`flex gap-3 border rounded-lg p-3 cursor-pointer ${mode === 'registered' ? 'border-blue-500 bg-blue-50' : ''}`}>
            <input type="radio" name="recipient" checked={mode === 'registered'} disabled={!registered?.registered_email} onChange={() => setMode('registered')} />
            <span className="text-sm"><span className="font-medium block">Send to registered email</span>
              <span className="text-gray-500 break-all">{!registered ? 'Looking up…' : registered.registered_email || 'No valid email on this account'}{registered?.former ? ' (address held before the account was disabled)' : ''}</span></span>
          </label>
          <label className={`flex gap-3 border rounded-lg p-3 cursor-pointer ${mode === 'custom' ? 'border-blue-500 bg-blue-50' : ''}`}>
            <input type="radio" name="recipient" checked={mode === 'custom'} onChange={() => setMode('custom')} />
            <span className="text-sm flex-1"><span className="font-medium block">Enter email address</span>
              <Input type="email" className="mt-1.5" placeholder="name@example.com" value={email} onFocus={() => setMode('custom')} onChange={(e) => setEmail(e.target.value)} />
              {mode === 'custom' && custom && !VALID.test(custom) && <span className="text-xs text-red-600">This is not a valid email address.</span>}</span>
          </label>
          <Button className="w-full" disabled={!ready || sending} onClick={() => onSend({ recipient_mode: mode, recipient_email: mode === 'custom' ? custom : undefined })}>
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send letter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
