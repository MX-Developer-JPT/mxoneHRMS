import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { Tile } from '@/components/ld/shared';

// Manager & HOD view — team learning, mandatory training, inductions, sign-offs and skill gaps.
export default function LdTeamLearning() {
  const [d, setD] = useState(null);
  useEffect(() => { ld('ld_getTeamLearning').then(setD).catch(e => toast.error(e.message)); }, []);
  if (!d) return <div className="flex justify-center p-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;

  const pending = d.inductions.flatMap(i => i.pending_for_me.map(p => ({ ...p, employee: i.name, induction_id: i.id })));
  const overdue = d.assignments.filter(a => a.overdue);
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Users className="w-6 h-6 text-blue-600" />Team Learning</h1>
        <p className="text-sm text-gray-500">{d.is_hod ? `Department view — ${d.departments.join(', ')}` : 'Your direct reports'}: induction, mandatory training, sign-offs and skill gaps.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="People" value={d.team.length} />
        <Tile label="Inductions running" value={d.inductions.filter(i => i.status === 'IN_PROGRESS').length} />
        <Tile label="Waiting for my action" value={pending.length} tone={pending.length ? 'text-amber-600' : ''} />
        <Tile label="Overdue training" value={overdue.length} tone={overdue.length ? 'text-red-600' : ''} />
        <Tile label="Skill gaps" value={d.skill_gaps.length} />
      </div>
      <Tabs defaultValue={pending.length ? 'actions' : 'team'}>
        <TabsList><TabsTrigger value="actions">Needs my action ({pending.length})</TabsTrigger><TabsTrigger value="team">Team ({d.team.length})</TabsTrigger><TabsTrigger value="inductions">Inductions ({d.inductions.length})</TabsTrigger><TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger><TabsTrigger value="gaps">Skill gaps ({d.skill_gaps.length})</TabsTrigger></TabsList>
        <TabsContent value="actions" className="space-y-2">
          {pending.length === 0 && <Card><CardContent className="p-6 text-sm text-gray-500 text-center">Nothing is waiting for you.</CardContent></Card>}
          {pending.map((p, i) => <Card key={i}><CardContent className="p-3 flex items-center justify-between gap-3"><div><div className="font-semibold">{p.employee} — {p.name}</div><div className="text-xs text-gray-500">Due {fmtDate(p.due_date)} · {p.status.replace('_', ' ').toLowerCase()}</div></div><Link to={`/LdInductionDetail?id=${p.induction_id}`}><Button size="sm">Open</Button></Link></CardContent></Card>)}
        </TabsContent>
        <TabsContent value="team"><Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Designation</th><th>Mandatory done</th><th>Overdue</th></tr></thead>
          <tbody>{d.team.map(t => <tr key={t.user_id} className="border-b last:border-0"><td className="p-2">{t.name}<div className="text-[11px] text-gray-400">{t.code}</div></td><td>{t.department}</td><td>{t.designation}</td><td>{t.mandatory_done}/{t.mandatory_total}</td><td className={t.overdue ? 'text-red-600 font-semibold' : ''}>{t.overdue}</td></tr>)}</tbody></table></CardContent></Card></TabsContent>
        <TabsContent value="inductions" className="space-y-2">
          {d.inductions.length === 0 && <Card><CardContent className="p-6 text-sm text-gray-500 text-center">No new-joiner inductions in your team.</CardContent></Card>}
          {d.inductions.map(i => (
            <Card key={i.id}><CardContent className="p-3 flex flex-wrap items-center gap-3 justify-between">
              <div className="min-w-[200px]"><div className="font-semibold">{i.name}</div><div className="text-xs text-gray-500">{i.current_gate} · joined {fmtDate(i.doj)}</div></div>
              <div className="w-40"><Progress value={i.progress.percent} className="h-1.5" /><div className="text-[10px] text-gray-500">{i.progress.done}/{i.progress.total}</div></div>
              <div className="flex items-center gap-2">{i.overdue_gates > 0 && <Badge variant="outline" className="border-red-300 text-red-700">Overdue</Badge>}<Link to={`/LdInductionDetail?id=${i.id}`}><Button size="sm" variant="outline">Open</Button></Link></div>
            </CardContent></Card>
          ))}
        </TabsContent>
        <TabsContent value="overdue"><Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Training</th><th>Due</th><th>Type</th></tr></thead>
          <tbody>{overdue.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-gray-500">Nothing overdue 🎉</td></tr>}{overdue.map(a => <tr key={a.id} className="border-b last:border-0"><td className="p-2">{a.employee_name}</td><td>{a.course_title}</td><td className="text-red-600">{fmtDate(a.due_date)}</td><td>{a.mandatory ? 'Mandatory' : 'Assigned'}</td></tr>)}</tbody></table></CardContent></Card></TabsContent>
        <TabsContent value="gaps"><Card><CardContent className="p-0 overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Skill</th><th>Current</th><th>Required</th><th>Next assessment</th></tr></thead>
          <tbody>{d.skill_gaps.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-500">No skill gaps recorded.</td></tr>}{d.skill_gaps.map(s => <tr key={s.id} className="border-b last:border-0"><td className="p-2">{s.employee_name}</td><td>{s.skill_name}</td><td>{s.current}</td><td>{s.required}</td><td>{fmtDate(s.next_assessment)}</td></tr>)}</tbody></table></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}
