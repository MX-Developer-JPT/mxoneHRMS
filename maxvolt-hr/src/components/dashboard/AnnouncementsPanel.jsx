import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, AlertTriangle, Paperclip, ChevronRight, CheckCheck, Bell, Calendar, FileText, PartyPopper } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isAnnouncementForEmployee } from '@/lib/announcementAudience';
import { MAX_SHOWN, dateOf, isRead, pickAnnouncements, whenLabel } from '@/lib/announcementPriority';

const CATEGORY = {
  urgent: { label: 'Urgent', icon: AlertTriangle, chip: 'bg-red-600 text-white' },
  policy: { label: 'Policy', icon: FileText, chip: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' },
  event: { label: 'Event', icon: PartyPopper, chip: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' },
  holiday: { label: 'Holiday', icon: Calendar, chip: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300' },
  general: { label: 'General', icon: Bell, chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
};
const catOf = (a) => CATEGORY[a.category] || CATEGORY.general;
// The top of every role's dashboard: what the company needs people to read. Shows nothing at all when there is nothing to read.
export default function AnnouncementsPanel({ user, width = 'max-w-6xl' }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [marking, setMarking] = useState(false);
  const role = user?.custom_role || user?.role;
  const isHr = role === 'hr' || role === 'admin';

  const load = useCallback(async () => {
    try {
      const [published, emp] = await Promise.all([
        base44.entities.Announcement.filter({ status: 'published' }, '-created_date', 60).catch(() => []),
        isHr ? Promise.resolve([]) : base44.entities.Employee.filter({ user_id: user.id }).catch(() => []),
      ]);
      // HR / admin see every published announcement (oversight); everyone else only those that targeted them.
      setList(isHr ? published : published.filter(a => isAnnouncementForEmployee(a, emp?.[0])));
    } catch { setList([]); }
  }, [user?.id, isHr]);
  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const shown = useMemo(() => (list ? pickAnnouncements(list, user.id) : []), [list, user?.id]);
  if (!list) return null;
  if (shown.length === 0) return null;

  const unread = shown.filter(a => !isRead(a, user.id));
  const markLocal = (ids) => setList(cur => cur.map(a => (ids.includes(a.id) ? { ...a, read_by: [...(a.read_by || []).filter(r => r.user_id !== user.id), { user_id: user.id, read_at: new Date().toISOString() }] } : a)));
  const openIt = (a) => {
    setOpen(a);
    if (!isRead(a, user.id)) { markLocal([a.id]); base44.functions.invoke('markAnnouncementRead', { announcement_id: a.id }).catch(() => {}); }
  };
  const markAll = async () => {
    setMarking(true);
    const ids = unread.map(a => a.id);
    await Promise.all(ids.map(id => base44.functions.invoke('markAnnouncementRead', { announcement_id: id }).catch(() => {})));
    markLocal(ids); setMarking(false);
  };
  const visible = shown.slice(0, MAX_SHOWN);
  const more = shown.length - visible.length;
  const urgentUnread = unread.some(a => a.category === 'urgent');

  return (
    <div className="p-4 md:p-6 pb-0 md:pb-0">
      <div className={`${width} mx-auto`}>
        <Card className={`overflow-hidden border-2 ${urgentUnread ? 'border-red-300 dark:border-red-800' : 'border-primary/20'}`}>
          <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${urgentUnread ? 'bg-red-50 dark:bg-red-950/30' : 'bg-primary/5'}`}>
            <Megaphone className={`w-4 h-4 ${urgentUnread ? 'text-red-600' : 'text-primary'}`} />
            <h2 className="text-sm font-semibold text-foreground">Announcements</h2>
            {unread.length > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">{unread.length} new</span>}
            <div className="ml-auto flex items-center gap-1">
              {unread.length > 1 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll} disabled={marking}><CheckCheck className="w-3.5 h-3.5 mr-1" />Mark all read</Button>}
              {isHr && <Link to={createPageUrl('AnnouncementManagement')} className="text-xs text-primary hover:underline px-2">Manage</Link>}
              <Link to={createPageUrl('Announcements')} className="text-xs text-primary hover:underline px-2">View all</Link>
            </div>
          </div>
          <CardContent className="p-0 divide-y">
            {visible.map(a => {
              const c = catOf(a); const Icon = c.icon; const read = isRead(a, user.id); const urgent = a.category === 'urgent';
              return (
                <button key={a.id} type="button" onClick={() => openIt(a)} className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50 ${urgent && !read ? 'bg-red-50/70 dark:bg-red-950/20' : ''}`}>
                  <span className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${urgent ? 'bg-red-100 text-red-600 dark:bg-red-950/60' : 'bg-muted text-muted-foreground'}`}><Icon className="w-4 h-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {!read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                      <span className={`text-sm ${read ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground'}`}>{a.title}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${c.chip}`}>{c.label}</span>
                      {a.attachment_url && <Paperclip className="w-3 h-3 text-muted-foreground" aria-label="Has an attachment" />}
                    </span>
                    <span className={`block text-xs mt-0.5 line-clamp-2 ${read ? 'text-muted-foreground/80' : 'text-muted-foreground'}`}>{a.content}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0 pt-0.5 whitespace-nowrap">{whenLabel(a)}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </button>
              );
            })}
            {more > 0 && <Link to={createPageUrl('Announcements')} className="block text-center text-xs text-primary hover:underline py-2.5">{more} more announcement{more === 1 ? '' : 's'} →</Link>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {open && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 mb-1"><span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${catOf(open).chip}`}>{catOf(open).label}</span><span className="text-xs text-muted-foreground">{dateOf(open).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
                <DialogTitle className="text-lg leading-snug">{open.title}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">{open.content}</p>
              {open.attachment_url && <a href={open.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><Paperclip className="w-4 h-4" />Open attachment</a>}
              <div className="flex justify-end pt-2"><Button variant="outline" size="sm" onClick={() => setOpen(null)}>Close</Button></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
