import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Plus, X, CheckCircle, Clock, RefreshCw, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import UnderDevelopmentBanner from '@/components/UnderDevelopmentBanner';

const STATUS_COLORS = {
  active: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  extended: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function PIPManagement() {
  const [user, setUser] = useState(null);
  const [pips, setPips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedPIP, setSelectedPIP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    employee_user_id: '', start_date: '', end_date: '', reason: '',
    pip_goals: [{ goal_description: '', target_outcome: '', timeline: '', status: 'pending' }],
    review_checkpoints: [{ review_date: '', outcome: 'pending', notes: '' }]
  });
  const [saving, setSaving] = useState(false);
  const [pipEmpOpen, setPipEmpOpen] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    const u = await base44.auth.me();
    setUser(u);
    const isHR = u.role === 'admin' || u.role === 'hr';
    const [pipsRes, empsRes, usersRes] = await Promise.all([
      isHR ? base44.entities.PerformanceImprovementPlan.list('-created_date', 50) : base44.entities.PerformanceImprovementPlan.filter({ manager_user_id: u.id }),
      base44.entities.Employee.filter({ status: 'active' }),
      base44.functions.invoke('getAllUsers', {})
    ]);
    setPips(pipsRes || []);
    setEmployees(empsRes || []);
    setUsers(usersRes?.data?.users || []);
    setLoading(false);
  };

  const userMap = {};
  for (const u of users) userMap[u.id] = u;

  const isHR = user?.role === 'admin' || user?.role === 'hr';
  const isMgr = user?.role === 'management' || isHR;

  const addGoal = () => setForm(p => ({ ...p, pip_goals: [...p.pip_goals, { goal_description: '', target_outcome: '', timeline: '', status: 'pending' }] }));
  const removeGoal = (i) => setForm(p => ({ ...p, pip_goals: p.pip_goals.filter((_, idx) => idx !== i) }));
  const updateGoal = (i, k, v) => setForm(p => ({ ...p, pip_goals: p.pip_goals.map((g, idx) => idx === i ? { ...g, [k]: v } : g) }));

  const addCheckpoint = () => setForm(p => ({ ...p, review_checkpoints: [...p.review_checkpoints, { review_date: '', outcome: 'pending', notes: '' }] }));
  const removeCheckpoint = (i) => setForm(p => ({ ...p, review_checkpoints: p.review_checkpoints.filter((_, idx) => idx !== i) }));
  const updateCheckpoint = (i, k, v) => setForm(p => ({ ...p, review_checkpoints: p.review_checkpoints.map((c, idx) => idx === i ? { ...c, [k]: v } : c) }));

  const handleSavePIP = async () => {
    setSaving(true);
    await base44.entities.PerformanceImprovementPlan.create({ ...form, manager_user_id: user.id, status: 'active' });
    setShowForm(false);
    setForm({ employee_user_id: '', start_date: '', end_date: '', reason: '', pip_goals: [{ goal_description: '', target_outcome: '', timeline: '', status: 'pending' }], review_checkpoints: [{ review_date: '', outcome: 'pending', notes: '' }] });
    setSaving(false);
    await init();
  };

  const handleUpdatePIPStatus = async (pip, status) => {
    await base44.entities.PerformanceImprovementPlan.update(pip.id, { status });
    await init();
  };

  const handleUpdateGoalProgress = async (pip, goalIndex, progressUpdate) => {
    const updatedGoals = (pip.pip_goals || []).map((g, i) => i === goalIndex ? { ...g, progress_update: progressUpdate, status: 'in_progress' } : g);
    await base44.entities.PerformanceImprovementPlan.update(pip.id, { pip_goals: updatedGoals });
    await init();
  };

  const handleAcknowledge = async (pip) => {
    await base44.entities.PerformanceImprovementPlan.update(pip.id, { employee_acknowledgement: true, acknowledged_at: new Date().toISOString() });
    await init();
  };

  const overduePIPs = pips.filter(p => p.status === 'active' && new Date(p.end_date) < new Date());

  return (
    <div className="min-h-screen bg-gray-50">
      <UnderDevelopmentBanner pageName="PIP Management" />
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">PIP Management</h1>
            <p className="text-xs text-gray-500">Performance Improvement Plans</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isMgr && <Button onClick={() => setShowForm(true)} className="bg-orange-500 hover:bg-orange-600 text-white gap-2"><Plus className="w-4 h-4" /> New PIP</Button>}
          <Button variant="outline" size="icon" onClick={init}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="p-6 max-w-screen-xl mx-auto space-y-4">
        {overduePIPs.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700">{overduePIPs.length} PIP(s) have exceeded their end date and need resolution.</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" /></div>
        ) : pips.length === 0 ? (
          <div className="bg-white rounded-xl border text-center py-16">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
            <p className="font-semibold text-gray-600">No PIPs found</p>
            <p className="text-sm text-gray-400 mt-1">Great! No performance improvement plans are active.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pips.map(pip => (
              <PIPCard
                key={pip.id}
                pip={pip}
                userMap={userMap}
                currentUser={user}
                isManager={isMgr}
                onUpdateStatus={handleUpdatePIPStatus}
                onUpdateGoalProgress={handleUpdateGoalProgress}
                onAcknowledge={handleAcknowledge}
              />
            ))}
          </div>
        )}
      </div>

      {/* New PIP Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-bold">Create Performance Improvement Plan</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-sm font-medium text-gray-700">Employee *</label>
                <Popover open={pipEmpOpen} onOpenChange={setPipEmpOpen}>
                  <PopoverTrigger asChild>
                    <button type="button" className="mt-1 flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm h-9 hover:bg-accent">
                      <span className={form.employee_user_id ? 'text-foreground' : 'text-muted-foreground'}>
                        {form.employee_user_id ? (userMap[form.employee_user_id]?.full_name || form.employee_user_id) : 'Select employee'}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search employee..." />
                      <CommandList>
                        <CommandEmpty>No employee found.</CommandEmpty>
                        <CommandGroup>
                          {employees.map(e => (
                            <CommandItem
                              key={e.user_id}
                              value={`${userMap[e.user_id]?.full_name || ''} ${e.employee_code || ''}`}
                              onSelect={() => { setForm(p => ({ ...p, employee_user_id: e.user_id })); setPipEmpOpen(false); }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${form.employee_user_id === e.user_id ? 'opacity-100' : 'opacity-0'}`} />
                              {userMap[e.user_id]?.full_name || e.user_id}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Reason for PIP *</label>
                <textarea className="w-full mt-1 border rounded-lg p-2 text-sm resize-none" rows={3} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Describe the performance issues that necessitate this PIP..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-sm font-medium text-gray-700">Start Date *</label><Input type="date" className="mt-1" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} /></div>
                <div><label className="text-sm font-medium text-gray-700">End Date *</label><Input type="date" className="mt-1" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} /></div>
              </div>

              {/* PIP Goals */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-semibold text-gray-700">Improvement Goals *</label>
                  <Button size="sm" variant="outline" onClick={addGoal}><Plus className="w-3 h-3 mr-1" /> Add Goal</Button>
                </div>
                <div className="space-y-3">
                  {form.pip_goals.map((goal, i) => (
                    <div key={i} className="border rounded-lg p-3 bg-orange-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-orange-700">Goal {i + 1}</span>
                        {form.pip_goals.length > 1 && <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeGoal(i)}><X className="w-3 h-3" /></Button>}
                      </div>
                      <Input placeholder="Goal description" value={goal.goal_description} onChange={e => updateGoal(i, 'goal_description', e.target.value)} />
                      <Input placeholder="Target outcome / success criteria" value={goal.target_outcome} onChange={e => updateGoal(i, 'target_outcome', e.target.value)} />
                      <Input type="date" value={goal.timeline} onChange={e => updateGoal(i, 'timeline', e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Review Checkpoints */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-semibold text-gray-700">Review Checkpoints</label>
                  <Button size="sm" variant="outline" onClick={addCheckpoint}><Plus className="w-3 h-3 mr-1" /> Add Checkpoint</Button>
                </div>
                <div className="space-y-3">
                  {form.review_checkpoints.map((cp, i) => (
                    <div key={i} className="border rounded-lg p-3 bg-blue-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-blue-700">Checkpoint {i + 1}</span>
                        {form.review_checkpoints.length > 1 && <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeCheckpoint(i)}><X className="w-3 h-3" /></Button>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="date" value={cp.review_date} onChange={e => updateCheckpoint(i, 'review_date', e.target.value)} />
                        <Input placeholder="Notes" value={cp.notes} onChange={e => updateCheckpoint(i, 'notes', e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button onClick={handleSavePIP} disabled={saving || !form.employee_user_id || !form.reason} className="bg-orange-500 hover:bg-orange-600 text-white">
                  {saving ? 'Creating...' : 'Create PIP'}
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PIPCard({ pip, userMap, currentUser, isManager, onUpdateStatus, onUpdateGoalProgress, onAcknowledge }) {
  const [expanded, setExpanded] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState({});
  const daysLeft = Math.ceil((new Date(pip.end_date) - new Date()) / (1000 * 60 * 60 * 24));
  const isMyPIP = pip.employee_user_id === currentUser?.id;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-bold text-sm">
              {userMap[pip.employee_user_id]?.full_name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="font-semibold text-gray-800">{userMap[pip.employee_user_id]?.full_name || pip.employee_user_id}</p>
              <p className="text-xs text-gray-400">{pip.start_date} → {pip.end_date} · {pip.pip_goals?.length || 0} goals</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[pip.status]}`}>{pip.status}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${daysLeft < 0 ? 'bg-red-100 text-red-600' : daysLeft <= 7 ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-600'}`}>
              {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
            </span>
          </div>
        </div>
        {pip.reason && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{pip.reason}</p>}
      </div>

      {expanded && (
        <div className="border-t bg-gray-50 p-4 space-y-4">
          {/* Acknowledge button for employee */}
          {isMyPIP && !pip.employee_acknowledgement && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-sm text-yellow-700">Please acknowledge receipt of this PIP.</p>
              <Button size="sm" onClick={() => onAcknowledge(pip)} className="bg-yellow-500 hover:bg-yellow-600 text-white">Acknowledge</Button>
            </div>
          )}
          {pip.employee_acknowledgement && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" /> Acknowledged by employee
            </div>
          )}

          {/* Goals */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Improvement Goals</h4>
            <div className="space-y-2">
              {(pip.pip_goals || []).map((goal, i) => (
                <div key={i} className="bg-white border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{goal.goal_description}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Target: {goal.target_outcome}</p>
                      {goal.timeline && <p className="text-xs text-gray-400 mt-0.5">Due: {goal.timeline}</p>}
                      {goal.progress_update && <p className="text-xs text-blue-600 mt-1 italic">Progress: {goal.progress_update}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${goal.status === 'achieved' ? 'bg-green-100 text-green-700' : goal.status === 'not_achieved' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {goal.status}
                    </span>
                  </div>
                  {isMyPIP && pip.status === 'active' && (
                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 text-xs border rounded px-2 py-1"
                        placeholder="Update progress..."
                        value={progressUpdates[i] || ''}
                        onChange={e => setProgressUpdates(p => ({ ...p, [i]: e.target.value }))}
                      />
                      <Button size="sm" className="text-xs h-7 px-3" onClick={() => onUpdateGoalProgress(pip, i, progressUpdates[i] || '')}>Update</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Checkpoints */}
          {pip.review_checkpoints?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Review Checkpoints</h4>
              <div className="space-y-2">
                {pip.review_checkpoints.map((cp, i) => (
                  <div key={i} className="bg-white border rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{cp.review_date}</p>
                      {cp.notes && <p className="text-xs text-gray-500">{cp.notes}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cp.outcome === 'satisfactory' ? 'bg-green-100 text-green-700' : cp.outcome === 'unsatisfactory' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {cp.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manager Actions */}
          {isManager && pip.status === 'active' && (
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onUpdateStatus(pip, 'completed')}>Mark Completed</Button>
              <Button size="sm" variant="outline" onClick={() => onUpdateStatus(pip, 'extended')}>Extend PIP</Button>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => onUpdateStatus(pip, 'failed')}>Mark Failed</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}