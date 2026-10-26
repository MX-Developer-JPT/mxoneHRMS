import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, GraduationCap, ClipboardCheck, AlertTriangle, CalendarClock, Award, Users } from 'lucide-react';
import { ld } from '@/lib/ld';
import { createPageUrl } from '@/utils';
import { Tile } from '@/components/ld/shared';
import { SignoffList, AtRiskList, OverdueTrainingList, ExpiringCertList } from '@/components/ldtrainer/TrainerLists';

// Home screen for the L&D Trainer role: what needs action today. This role is an operator role, not an employee one.
export default function LdTrainerDashboard({ user }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { ld('ld_getTrainerHome', { scope: 'all' }).then(setData).catch(e => setErr(e.message)); }, []);
  const k = data?.kpis;
  const links = [
    ['L&D Control Centre', 'LdControlCentre', GraduationCap], ['Trainer Workbench', 'LdTrainerWorkbench', ClipboardCheck],
    ['Team Learning', 'LdTeamLearning', Users],
  ];
  const who = user?.display_name || user?.full_name;
  return (
    <div>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 pb-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><GraduationCap className="w-6 h-6 text-blue-600" />Trainer desk</h1>
          <p className="text-sm text-gray-500">Welcome{who ? `, ${who}` : ''}. Here is what needs you in Learning &amp; Development today.</p>
        </div>
        <div className="flex flex-wrap gap-2">{links.map(([label, page, Icon]) => <Link key={page} to={createPageUrl(page)}><Button variant="outline" size="sm"><Icon className="w-4 h-4 mr-1.5" />{label}</Button></Link>)}</div>
        {!data && !err && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}
        {err && <div className="text-sm text-red-600">{err}</div>}
        {data && <>
          {data.paused && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Inductions are currently paused by L&amp;D.</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Awaiting sign-off" value={k.awaiting_signoff} tone={k.awaiting_signoff ? 'text-blue-700' : ''} />
            <Tile label="Learners at risk" value={k.at_risk} tone={k.at_risk ? 'text-red-600' : ''} />
            <Tile label="Overdue training" value={k.overdue_assignments} tone={k.overdue_assignments ? 'text-red-600' : ''} />
            <Tile label="Certificates expiring (30d)" value={k.certs_expiring_30d} tone={k.certs_expiring_30d ? 'text-amber-600' : ''} />
            <Tile label="My learners" value={k.my_learners} />
            <Tile label="Active inductions" value={k.active_inductions} />
            <Tile label="Open assignments" value={k.open_assignments} />
            <Tile label="Waivers to decide" value={k.pending_waivers} tone={k.pending_waivers ? 'text-blue-700' : ''} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-1"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-blue-600" />Waiting for sign-off</CardTitle></CardHeader><CardContent><SignoffList rows={data.awaiting_signoff} limit={5} /></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-600" />Learners at risk</CardTitle></CardHeader><CardContent><AtRiskList rows={data.at_risk} limit={5} /></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-base flex items-center gap-2"><CalendarClock className="w-4 h-4 text-orange-600" />Overdue training</CardTitle></CardHeader><CardContent><OverdueTrainingList rows={data.overdue_assignments} limit={5} /></CardContent></Card>
            <Card><CardHeader className="pb-1"><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4 text-amber-600" />Certificates expiring soon</CardTitle></CardHeader><CardContent><ExpiringCertList rows={data.expiring_certs} limit={5} /></CardContent></Card>
          </div>
          <div className="text-right"><Link to={createPageUrl('LdTrainerWorkbench')} className="text-sm text-blue-700 hover:underline">Open the full workbench →</Link></div>
        </>}
      </div>
    </div>
  );
}
