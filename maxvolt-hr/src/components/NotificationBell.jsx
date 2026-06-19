import React, { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck, Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const API_BASE = '/api';
const getToken = () => localStorage.getItem('base44_access_token');

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) return null;
  return res.json();
}

const TYPE_ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TYPE_COLORS = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    const data = await apiFetch('/notifications');
    if (data) {
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markRead = async (id) => {
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await apiFetch('/notifications/read-all', { method: 'PATCH' });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnread(0);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) load(); }}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-white/8">
            <span className="font-semibold text-sm text-slate-900 dark:text-white">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Bell className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.map(n => {
                const Icon = TYPE_ICONS[n.type] || Info;
                const color = TYPE_COLORS[n.type] || 'text-blue-500';
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 px-4 py-3 border-b border-slate-50 dark:border-white/5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors ${n.is_read ? 'opacity-60' : ''}`}
                    onClick={() => { if (!n.is_read) markRead(n.id); if (n.link) window.location.href = n.link; }}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white leading-tight">{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{n.message}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {!n.is_read && <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
