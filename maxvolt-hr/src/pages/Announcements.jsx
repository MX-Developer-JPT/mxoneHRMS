import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bell, Megaphone, AlertCircle, Calendar, Search, Paperclip, Star, ChevronRight, MapPin, Building2, Users, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { safeDate } from '@/lib/dateUtils';
import { isAnnouncementForEmployee } from '@/lib/announcementAudience';

const categoryConfig = {
  general: { color: 'bg-blue-100 text-blue-800', border: 'border-blue-200', icon: Bell, label: 'General' },
  policy: { color: 'bg-purple-100 text-purple-800', border: 'border-purple-200', icon: AlertCircle, label: 'Policy' },
  event: { color: 'bg-green-100 text-green-800', border: 'border-green-200', icon: Megaphone, label: 'Event' },
  holiday: { color: 'bg-orange-100 text-orange-800', border: 'border-orange-200', icon: Calendar, label: 'Holiday' },
  urgent: { color: 'bg-red-100 text-red-800', border: 'border-red-200', icon: AlertCircle, label: 'Urgent' }
};

export default function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewerDoc, setViewerDoc] = useState(null);
  const [openAnnouncement, setOpenAnnouncement] = useState(null);
  const [canSeeReadStats, setCanSeeReadStats] = useState(false);
  const [readStats, setReadStats] = useState(null);
  const [loadingReadStats, setLoadingReadStats] = useState(false);
  const [readStatsTab, setReadStatsTab] = useState('unread');

  const handleOpenAnnouncement = (announcement) => {
    setOpenAnnouncement(announcement);
    setReadStats(null);
    setReadStatsTab('unread');
    // Fire-and-forget — failure here shouldn't block reading.
    base44.functions.invoke('markAnnouncementRead', { announcement_id: announcement.id }).catch(() => {});
    if (canSeeReadStats) loadReadStats(announcement.id);
  };

  const loadReadStats = async (announcementId) => {
    setLoadingReadStats(true);
    try {
      const res = await base44.functions.invoke('getAnnouncementReadStats', { announcement_id: announcementId });
      const d = res?.data || res;
      if (d?.success) setReadStats(d);
    } catch (_) {}
    setLoadingReadStats(false);
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      const role = currentUser.custom_role || currentUser.role;
      const isHR = role === 'hr' || role === 'admin';
      setCanSeeReadStats(isHR || role === 'management');
      const published = await base44.entities.Announcement.filter({ status: 'published' }, '-publish_date');
      const empRecord = await base44.entities.Employee.filter({ user_id: currentUser.id });

      // HR/admin see every published announcement here too (same oversight
      // rationale as their dashboard widget and AnnouncementManagement) —
      // everyone else only sees ones that actually targeted them, via the
      // same audience rule the notification itself is sent with.
      const filtered = isHR ? published : published.filter(a => isAnnouncementForEmployee(a, empRecord[0]));

      setAnnouncements(filtered);
    } catch (error) {
      console.error('Error loading announcements:', error);
    }
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;

  const urgentAnnouncements = announcements.filter(a => a.category === 'urgent');

  const displayed = announcements.filter(a => {
    const matchesCategory = activeCategory === 'all' || a.category === activeCategory;
    const matchesSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) || (a.content || '').toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const categoryCounts = announcements.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Announcements</h1>
          <p className="text-gray-600 mt-1">Stay updated with company news and updates</p>
        </div>

        {/* Urgent Banner */}
        {urgentAnnouncements.length > 0 && (
          <div className="space-y-2">
            {urgentAnnouncements.map(a => (
              <button
                key={a.id}
                onClick={() => handleOpenAnnouncement(a)}
                className="w-full text-left bg-red-600 text-white rounded-xl p-4 flex items-start gap-3 shadow-lg hover:bg-red-700 transition-colors"
              >
                <AlertCircle className="w-6 h-6 mt-0.5 flex-shrink-0 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg">{a.title}</p>
                  <p className="text-red-100 text-sm mt-1 line-clamp-1">{a.content}</p>
                  <p className="text-red-200 text-xs mt-2">{safeDate(a.publish_date || a.created_date, 'MMMM d, yyyy')}</p>
                </div>
                <ChevronRight className="w-5 h-5 flex-shrink-0 mt-1 opacity-70" />
              </button>
            ))}
          </div>
        )}

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9 bg-white" placeholder="Search announcements..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 flex-wrap">
          {[{ key: 'all', label: 'All', count: announcements.length }, ...Object.entries(categoryConfig).map(([key, cfg]) => ({ key, label: cfg.label, count: categoryCounts[key] || 0 }))].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveCategory(tab.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${activeCategory === tab.key ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 hover:bg-gray-100 border'}`}
            >
              {tab.label} {tab.count > 0 && <span className="ml-1 opacity-70">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* Announcement List */}
        {displayed.length > 0 ? (
          <div className="space-y-3">
            {displayed.map(announcement => {
              const cfg = categoryConfig[announcement.category] || categoryConfig.general;
              const Icon = cfg.icon;
              return (
                <Card
                  key={announcement.id}
                  className={`hover:shadow-md transition-all border-l-4 ${cfg.border} cursor-pointer`}
                  onClick={() => handleOpenAnnouncement(announcement)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${cfg.color} flex-shrink-0`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <p className="text-base font-semibold leading-tight text-blue-700 hover:underline">{announcement.title}</p>
                          <Badge className={`${cfg.color} text-xs flex-shrink-0`}>{cfg.label.toUpperCase()}</Badge>
                        </div>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1">{announcement.content}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {safeDate(announcement.publish_date || announcement.created_date, 'MMMM d, yyyy')}
                          </span>
                          {announcement.attachment_url && (
                            <span className="flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" /> Attachment</span>
                          )}
                          {announcement.target_audience === 'specific_departments' && (
                            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {announcement.target_departments?.join(', ')}
                            </span>
                          )}
                          {announcement.target_audience === 'specific_locations' && (
                            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {announcement.target_locations?.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 flex-shrink-0 text-gray-300 mt-1.5" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Bell className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 text-lg font-medium">No announcements found</p>
              <p className="text-gray-400 text-sm mt-1">{search || activeCategory !== 'all' ? 'Try adjusting your filters' : 'Check back later for updates'}</p>
            </CardContent>
          </Card>
        )}
      </div>
      <DocViewerModal
        open={!!viewerDoc}
        url={viewerDoc?.url}
        title={viewerDoc?.title}
        onClose={() => setViewerDoc(null)}
      />

      <Dialog open={!!openAnnouncement} onOpenChange={(o) => !o && setOpenAnnouncement(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {openAnnouncement && (() => {
            const cfg = categoryConfig[openAnnouncement.category] || categoryConfig.general;
            const Icon = cfg.icon;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl ${cfg.color} flex-shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <DialogTitle className="text-xl leading-tight">{openAnnouncement.title}</DialogTitle>
                        <Badge className={`${cfg.color} text-xs flex-shrink-0`}>{cfg.label.toUpperCase()}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {safeDate(openAnnouncement.publish_date || openAnnouncement.created_date, 'MMMM d, yyyy')}
                        </span>
                        {openAnnouncement.target_audience === 'specific_departments' && openAnnouncement.target_departments?.length > 0 && (
                          <span className="flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            <Building2 className="w-3.5 h-3.5" /> {openAnnouncement.target_departments.join(', ')}
                          </span>
                        )}
                        {openAnnouncement.target_audience === 'specific_locations' && openAnnouncement.target_locations?.length > 0 && (
                          <span className="flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            <MapPin className="w-3.5 h-3.5" /> {openAnnouncement.target_locations.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </DialogHeader>
                <div className="mt-2 space-y-4">
                  <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{openAnnouncement.content}</p>
                  {openAnnouncement.attachment_url && (
                    <button
                      onClick={() => setViewerDoc({ url: openAnnouncement.attachment_url, title: openAnnouncement.title })}
                      className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 text-sm font-medium hover:underline"
                    >
                      <Paperclip className="w-4 h-4" /> View Attachment
                    </button>
                  )}

                  {canSeeReadStats && (
                    <div className="border-t pt-4">
                      <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-2"><Users className="w-4 h-4" /> Read Stats</p>
                      {loadingReadStats ? (
                        <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                      ) : readStats ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                              <p className="text-lg font-bold text-gray-700">{readStats.total}</p>
                              <p className="text-xs text-gray-500">Total</p>
                            </div>
                            <div className="bg-green-50 rounded-lg p-2.5 text-center">
                              <p className="text-lg font-bold text-green-700">{readStats.read_count}</p>
                              <p className="text-xs text-gray-500">Read</p>
                            </div>
                            <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                              <p className="text-lg font-bold text-amber-700">{readStats.unread_count}</p>
                              <p className="text-xs text-gray-500">Not Read</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setReadStatsTab('read')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${readStatsTab === 'read' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border'}`}>Read ({readStats.read_count})</button>
                            <button onClick={() => setReadStatsTab('unread')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${readStatsTab === 'unread' ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border'}`}>Not Read ({readStats.unread_count})</button>
                          </div>
                          <div className="space-y-1.5 max-h-56 overflow-y-auto">
                            {readStatsTab === 'read' ? (
                              readStats.read.length ? readStats.read.map(u => (
                                <div key={u.user_id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-1.5 bg-green-50/50 border-green-100">
                                  <p className="text-sm font-medium truncate">{u.full_name}</p>
                                  <span className="flex items-center gap-1 text-xs text-green-700 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> {safeDate(u.read_at, 'MMM d, h:mm a')}</span>
                                </div>
                              )) : <p className="text-sm text-gray-400 text-center py-4">No one has read this yet</p>
                            ) : (
                              readStats.unread.length ? readStats.unread.map(u => (
                                <div key={u.user_id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-1.5">
                                  <p className="text-sm font-medium truncate">{u.full_name}</p>
                                  <span className="flex items-center gap-1 text-xs text-amber-600 flex-shrink-0"><Clock className="w-3.5 h-3.5" /> Not read</span>
                                </div>
                              )) : <p className="text-sm text-gray-400 text-center py-4">Everyone in the audience has read this</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}