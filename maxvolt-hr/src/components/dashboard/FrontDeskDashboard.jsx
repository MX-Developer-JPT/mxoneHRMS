import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Laptop, QrCode, RefreshCw, MapPin, ChevronRight, UserPlus, FileText } from 'lucide-react';

const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const istMonth = () => istToday().slice(0, 7);
const fmtShort = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—');
const fmtTime = (d) => {
  const s = String(d || '');
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
};

function Tile({ icon: Icon, label, value, tone = 'text-gray-900', to }) {
  const body = (
    <div className="rounded-xl border bg-white p-4 h-full hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between">
        <div className={`text-3xl font-bold ${tone}`}>{value ?? '—'}</div>
        <Icon className="w-5 h-5 text-gray-300" />
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Panel({ title, to, linkLabel, children }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {to && <Link to={to} className="text-xs text-blue-600 hover:underline inline-flex items-center">{linkLabel || 'View all'}<ChevronRight className="w-3 h-3" /></Link>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const Empty = ({ text }) => <p className="text-sm text-gray-400 py-4 text-center">{text}</p>;

// Dashboard for the Front Desk Admin role: visitors, asset letters, business cards (no gate pass approvals).
export default function FrontDeskDashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const today = istToday();
    const month = istMonth();
    const [emps, visRes, locRes, assets, cards] = await Promise.all([
      base44.entities.Employee.list().catch(() => []),
      base44.functions.invoke('getVisitorsScoped', {}).catch(() => null),
      base44.functions.invoke('getGateAdminLocations', {}).catch(() => null),
      base44.entities.Asset.list('-created_date', 1000).catch(() => []),
      base44.entities.DigitalBusinessCard.list('-created_date', 1000).catch(() => []),
    ]);
    const empName = {};
    emps.forEach(e => { empName[e.user_id] = e.display_name; });
    const ld = locRes ? (locRes.data || locRes) : null;
    const locations = ld?.success && Array.isArray(ld.locations) ? ld.locations : null; // null = every location

    const vd = visRes ? (visRes.data || visRes) : null;
    const visitors = vd?.success ? vd.visitors : [];
    const visitorsToday = visitors.filter(v => String(v.expected_arrival || v.check_in_time || '').slice(0, 10) === today);
    const inside = visitors.filter(v => v.status === 'checked_in');

    const monthAssets = assets.filter(a => a.assigned_to_user_id && String(a.assignment_date || '').slice(0, 7) === month);
    const recentAssets = assets
      .filter(a => a.assigned_to_user_id && a.assignment_date)
      .sort((a, b) => String(b.assignment_date).localeCompare(String(a.assignment_date)))
      .slice(0, 6);

    setData({ visitorsToday, inside, monthAssets, recentAssets, cards: cards.length, locations, empName });
  }, []);

  useEffect(() => { load().catch(e => console.error('FrontDeskDashboard:', e.message)).finally(() => setLoading(false)); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } catch (e) { console.error('FrontDeskDashboard refresh:', e.message); }
    setRefreshing(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  if (!data) return null;
  const d = data;
  const first = (user?.full_name || user?.display_name || '').split(' ')[0];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Front Desk{first ? ` — welcome, ${first}` : ''}</h1>
          <p className="text-sm text-gray-500 flex items-center gap-1 flex-wrap">
            <MapPin className="w-3.5 h-3.5" />
            {d.locations ? `Your location${d.locations.length === 1 ? '' : 's'}: ${d.locations.join(', ') || 'none assigned'}` : 'All locations'}
            <span className="mx-1">·</span>{fmtShort(istToday())}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile icon={Users} label="Visitors expected today" value={d.visitorsToday.length} to="/VisitorManagement" />
        <Tile icon={UserPlus} label="Visitors inside now" value={d.inside.length} tone="text-green-600" to="/VisitorManagement" />
        <Tile icon={Laptop} label="Assets handed over this month" value={d.monthAssets.length} to="/AssetTracking" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Button asChild className="h-auto py-3 flex-col gap-1"><Link to="/VisitorManagement"><UserPlus className="w-5 h-5" /><span className="text-xs">Register a visitor</span></Link></Button>
        <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1"><Link to="/AssetTracking"><FileText className="w-5 h-5" /><span className="text-xs">Create asset letter</span></Link></Button>
        <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1"><Link to="/BusinessCardAdmin"><QrCode className="w-5 h-5" /><span className="text-xs">Business cards ({d.cards})</span></Link></Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Today's visitors" to="/VisitorManagement">
          {d.visitorsToday.length === 0 ? <Empty text="No visitors expected today." /> : (
            <div className="divide-y">
              {d.visitorsToday.slice(0, 6).map(v => (
                <div key={v.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{v.visitor_name}{v.company ? ` · ${v.company}` : ''}</div>
                    <div className="text-xs text-gray-500">{fmtTime(v.expected_arrival)}{v.location_name ? ` · ${v.location_name}` : ''}</div>
                  </div>
                  <Badge variant="outline" className={v.status === 'checked_in' ? 'border-green-300 text-green-700' : 'text-gray-600'}>{String(v.status || '').replace(/_/g, ' ')}</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent asset assignments" to="/AssetTracking" linkLabel="Asset tracking">
          {d.recentAssets.length === 0 ? <Empty text="No assets handed over yet." /> : (
            <div className="divide-y">
              {d.recentAssets.map(a => (
                <div key={a.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{a.asset_name || a.name || 'Asset'}</div>
                    <div className="text-xs text-gray-500">{d.empName[a.assigned_to_user_id] || '—'}</div>
                  </div>
                  <span className="text-xs text-gray-500">{fmtShort(a.assignment_date)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Visitors inside now" to="/VisitorManagement">
          {d.inside.length === 0 ? <Empty text="Nobody is checked in right now." /> : (
            <div className="divide-y">
              {d.inside.slice(0, 6).map(v => (
                <div key={v.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{v.visitor_name}</div>
                    <div className="text-xs text-gray-500">{v.purpose || ''}{v.location_name ? ` · ${v.location_name}` : ''}</div>
                  </div>
                  <span className="text-xs text-gray-500">in {fmtTime(v.check_in_time)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
