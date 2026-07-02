import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Award, Sparkles, Trophy, Cake, PartyPopper, Search, Heart,
  Star, Lightbulb, Users, Shield, Rocket, ThumbsUp, Send, RefreshCw
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const VALUES = [
  { key: 'Teamwork',        icon: Users,     color: 'bg-blue-100 text-blue-700 border-blue-200',       grad: 'from-blue-500 to-indigo-500' },
  { key: 'Innovation',      icon: Lightbulb, color: 'bg-amber-100 text-amber-700 border-amber-200',    grad: 'from-amber-500 to-orange-500' },
  { key: 'Ownership',       icon: Shield,    color: 'bg-emerald-100 text-emerald-700 border-emerald-200', grad: 'from-emerald-500 to-teal-500' },
  { key: 'Customer First',  icon: Heart,     color: 'bg-rose-100 text-rose-700 border-rose-200',       grad: 'from-rose-500 to-pink-500' },
  { key: 'Above & Beyond',  icon: Rocket,    color: 'bg-purple-100 text-purple-700 border-purple-200', grad: 'from-purple-500 to-fuchsia-500' },
  { key: 'Integrity',       icon: Star,      color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       grad: 'from-cyan-500 to-sky-500' },
];
const valueMeta = (k) => VALUES.find(v => v.key === k) || VALUES[0];

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export default function Recognition() {
  const [me, setMe] = useState(null);
  const isEmployee = (u) => { const r = u?.custom_role || u?.role; return r === 'employee'; };
  const [data, setData] = useState({ feed: [], leaderboard: [], birthdays: [], anniversaries: [], total_this_month: 0, month: '' });
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);

  // Give dialog
  const [showGive, setShowGive] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [selectedValue, setSelectedValue] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    try {
      const [user, emps] = await Promise.all([
        base44.auth.me().catch(() => null),
        base44.entities.Employee.list('-display_name', 1000).catch(() => []),
      ]);
      setMe(user);
      setEmployees(emps.filter(e => e.user_id && (!e.status || e.status === 'active') && e.display_name));
      await loadRecognition();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const loadRecognition = async () => {
    const res = await base44.functions.invoke('getRecognitionData', {});
    const d = res.data || res;
    if (d.success) setData(d);
  };

  const submitKudos = async () => {
    if (!selectedEmp || !selectedValue) { toast.error('Pick a colleague and a value'); return; }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('giveKudos', {
        receiver_id: selectedEmp.user_id, value: selectedValue, message,
      });
      const d = res.data || res;
      if (d.success) {
        toast.success(`Recognition sent to ${selectedEmp.display_name}! 🎉`);
        setShowGive(false);
        setSelectedEmp(null); setSelectedValue(''); setMessage(''); setEmpSearch('');
        loadRecognition();
      } else {
        toast.error(d.error || 'Could not send recognition');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setSubmitting(false);
  };

  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employees
      .filter(e => e.user_id !== me?.id)
      .filter(e => !q || e.display_name?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q))
      .slice(0, 30);
  }, [employees, empSearch, me]);

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400"><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Loading recognition…</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-rose-50 to-purple-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Award className="w-8 h-8 text-orange-500" /> Recognition Wall
            </h1>
            <p className="text-gray-500 mt-1">{data.total_this_month} recognitions given in {data.month} · celebrate your colleagues</p>
          </div>
          {!isEmployee(me) && (
            <Button onClick={() => setShowGive(true)} className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-md">
              <Sparkles className="w-4 h-4 mr-2" /> Give Recognition
            </Button>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Feed */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2"><ThumbsUp className="w-4 h-4" /> Recent Recognition</h2>
            {data.feed.length === 0 ? (
              <Card><CardContent className="p-10 text-center text-gray-400">
                <Award className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                No recognition yet — be the first to appreciate a colleague!
              </CardContent></Card>
            ) : data.feed.map(k => {
              const meta = valueMeta(k.value);
              const Icon = meta.icon;
              return (
                <Card key={k.id} className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${meta.grad} flex items-center justify-center flex-shrink-0 text-white font-bold`}>
                        {initials(k.receiver_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">
                          <span className="font-semibold">{k.giver_name}</span>
                          <span className="text-gray-500"> recognised </span>
                          <span className="font-semibold">{k.receiver_name}</span>
                        </p>
                        <Badge variant="outline" className={`mt-1 ${meta.color}`}>
                          <Icon className="w-3 h-3 mr-1" /> {k.value}
                        </Badge>
                        {k.message && <p className="text-sm text-gray-600 mt-2 italic">"{k.message}"</p>}
                        <p className="text-xs text-gray-400 mt-1.5">
                          {k.created_at ? formatDistanceToNow(new Date(k.created_at), { addSuffix: true }) : ''}
                          {k.receiver_dept && ` · ${k.receiver_dept}`}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Leaderboard */}
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-3">
                  <Trophy className="w-4 h-4 text-amber-500" /> Top Recognised — {data.month}
                </h2>
                {data.leaderboard.length === 0 ? (
                  <p className="text-sm text-gray-400">No recognition this month yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.leaderboard.map((l, i) => (
                      <div key={l.user_id} className="flex items-center gap-3">
                        <span className={`w-6 text-center font-bold ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-400' : 'text-gray-300'}`}>
                          {i + 1}
                        </span>
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {initials(l.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{l.name}</p>
                          <p className="text-xs text-gray-400 truncate">{l.dept}</p>
                        </div>
                        <Badge className="bg-amber-100 text-amber-700">{l.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Birthdays */}
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-3">
                  <Cake className="w-4 h-4 text-rose-500" /> Birthdays in {data.month}
                </h2>
                {data.birthdays.length === 0 ? (
                  <p className="text-sm text-gray-400">No birthdays this month.</p>
                ) : (
                  <div className="space-y-2">
                    {data.birthdays.map(b => (
                      <div key={b.user_id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {initials(b.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{b.name}</p>
                          <p className="text-xs text-gray-400 truncate">{b.dept}</p>
                        </div>
                        <span className="text-xs font-medium text-rose-500">{data.month.slice(0, 3)} {b.day}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Work Anniversaries */}
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-3">
                  <PartyPopper className="w-4 h-4 text-purple-500" /> Work Anniversaries
                </h2>
                {data.anniversaries.length === 0 ? (
                  <p className="text-sm text-gray-400">No anniversaries this month.</p>
                ) : (
                  <div className="space-y-2">
                    {data.anniversaries.map(a => (
                      <div key={a.user_id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {initials(a.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{a.name}</p>
                          <p className="text-xs text-gray-400 truncate">{a.dept}</p>
                        </div>
                        <Badge className="bg-purple-100 text-purple-700">{a.years} yr{a.years > 1 ? 's' : ''}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Give Recognition Dialog */}
      <Dialog open={showGive} onOpenChange={setShowGive}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-orange-500" /> Give Recognition</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Select colleague */}
            <div>
              <label className="text-sm font-medium text-gray-700">Colleague</label>
              {selectedEmp ? (
                <div className="mt-1 flex items-center gap-3 border rounded-lg p-2.5 bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                    {initials(selectedEmp.display_name)}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{selectedEmp.display_name}</p>
                    <p className="text-xs text-gray-400">{selectedEmp.designation} · {selectedEmp.department}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedEmp(null)}>Change</Button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input className="pl-9" placeholder="Search colleague…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
                  </div>
                  <div className="mt-2 max-h-44 overflow-y-auto border rounded-lg divide-y">
                    {filteredEmps.length === 0 ? (
                      <p className="p-3 text-sm text-gray-400">No colleagues found</p>
                    ) : filteredEmps.map(e => (
                      <button key={e.user_id} onClick={() => { setSelectedEmp(e); setEmpSearch(''); }}
                        className="w-full flex items-center gap-3 p-2.5 hover:bg-orange-50 text-left transition-colors">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {initials(e.display_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{e.display_name}</p>
                          <p className="text-xs text-gray-400 truncate">{e.designation} · {e.department}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Select value */}
            <div>
              <label className="text-sm font-medium text-gray-700">Recognise for</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {VALUES.map(v => {
                  const Icon = v.icon;
                  const active = selectedValue === v.key;
                  return (
                    <button key={v.key} onClick={() => setSelectedValue(v.key)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${active ? `bg-gradient-to-r ${v.grad} text-white border-transparent shadow` : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                      <Icon className="w-4 h-4" /> {v.key}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="text-sm font-medium text-gray-700">Message <span className="text-gray-400 font-normal">(optional)</span></label>
              <Textarea rows={3} className="mt-1" placeholder="Say something specific about what they did…" value={message} onChange={e => setMessage(e.target.value)} maxLength={500} />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowGive(false)}>Cancel</Button>
              <Button onClick={submitKudos} disabled={submitting || !selectedEmp || !selectedValue}
                className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white">
                {submitting ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Send Recognition</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
