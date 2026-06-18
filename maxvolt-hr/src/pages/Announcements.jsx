import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bell, Megaphone, AlertCircle, Calendar, Search, Paperclip, Star } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { format } from 'date-fns';

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

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      const published = await base44.entities.Announcement.filter({ status: 'published' }, '-publish_date');
      const empRecord = await base44.entities.Employee.filter({ user_id: currentUser.id });
      const userDepartment = empRecord[0]?.department;

      const filtered = published.filter(a => {
        if (a.target_audience === 'all') return true;
        if (a.target_audience === 'specific_departments' && a.target_departments) {
          return a.target_departments.includes(userDepartment);
        }
        return false;
      });

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
    const matchesSearch = !search || a.title.toLowerCase().includes(search.toLowerCase()) || a.content.toLowerCase().includes(search.toLowerCase());
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
              <div key={a.id} className="bg-red-600 text-white rounded-xl p-4 flex items-start gap-3 shadow-lg">
                <AlertCircle className="w-6 h-6 mt-0.5 flex-shrink-0 animate-pulse" />
                <div>
                  <p className="font-bold text-lg">{a.title}</p>
                  <p className="text-red-100 text-sm mt-1">{a.content}</p>
                  <p className="text-red-200 text-xs mt-2">{format(new Date(a.publish_date || a.created_date), 'MMMM d, yyyy')}</p>
                </div>
              </div>
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
          <div className="space-y-4">
            {displayed.map(announcement => {
              const cfg = categoryConfig[announcement.category] || categoryConfig.general;
              const Icon = cfg.icon;
              return (
                <Card key={announcement.id} className={`hover:shadow-lg transition-all border-l-4 ${cfg.border}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${cfg.color} flex-shrink-0 mt-0.5`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <CardTitle className="text-lg leading-tight">{announcement.title}</CardTitle>
                          <Badge className={`${cfg.color} text-xs flex-shrink-0`}>{cfg.label.toUpperCase()}</Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {format(new Date(announcement.publish_date || announcement.created_date), 'MMMM d, yyyy')}
                          </span>
                          {announcement.target_audience !== 'all' && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                              {announcement.target_departments?.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">{announcement.content}</p>
                    {announcement.attachment_url && (
                      <button
                        onClick={() => setViewerDoc({ url: announcement.attachment_url, title: announcement.title })}
                        className="inline-flex items-center gap-1.5 mt-3 text-blue-600 hover:text-blue-800 text-sm font-medium hover:underline">
                        <Paperclip className="w-4 h-4" /> View Attachment
                      </button>
                    )}
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
    </div>
  );
}