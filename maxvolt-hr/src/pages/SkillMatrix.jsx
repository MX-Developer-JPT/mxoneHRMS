import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Zap, Star, Users, Plus, Award } from 'lucide-react';

const PROFICIENCY_LABELS = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' };
const PROFICIENCY_COLORS = {
  1: 'bg-gray-100 text-gray-600',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-green-100 text-green-700',
  4: 'bg-purple-100 text-purple-700',
};

export default function SkillMatrix() {
  const [activeTab, setActiveTab] = useState('org');
  const [orgLoading, setOrgLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [orgData, setOrgData] = useState(null);
  const [mySkills, setMySkills] = useState([]);
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ skill_name: '', proficiency_level: '' });
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [empSkills, setEmpSkills] = useState({});

  useEffect(() => { loadOrg(); loadMe(); }, []);

  const loadOrg = async () => {
    setOrgLoading(true);
    try {
      const result = await base44.functions.invoke('getSkillMatrix', {});
      setOrgData(result?.data || result);
    } catch (e) {
      toast.error('Failed to load skill matrix');
      setOrgData({ skill_coverage: [], employees: [] });
    } finally {
      setOrgLoading(false);
    }
  };

  const loadMe = async () => {
    setMyLoading(true);
    try {
      const me = await base44.auth.me();
      setUser(me);
      const result = await base44.functions.invoke('getSkillMatrix', { user_id: me.id });
      setMySkills(result?.data?.my_skills || result?.my_skills || []);
    } catch (e) {
      setMySkills([]);
    } finally {
      setMyLoading(false);
    }
  };

  const handleAddSkill = async (e) => {
    e.preventDefault();
    if (!form.skill_name || !form.proficiency_level) { toast.error('Skill name and proficiency are required'); return; }
    setSaving(true);
    try {
      await base44.functions.invoke('saveSkillEntry', {
        skill_name: form.skill_name,
        proficiency_level: Number(form.proficiency_level),
      });
      toast.success('Skill added successfully');
      setForm({ skill_name: '', proficiency_level: '' });
      await loadMe();
    } catch (e) {
      toast.error('Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  const loadEmpSkills = async (emp) => {
    const key = emp.user_id || emp.name;
    if (expandedEmp === key) { setExpandedEmp(null); return; }
    setExpandedEmp(key);
    if (empSkills[key]) return;
    try {
      const result = await base44.functions.invoke('getSkillMatrix', { user_id: emp.user_id });
      const skills = result?.data?.my_skills || result?.my_skills || [];
      setEmpSkills(prev => ({ ...prev, [key]: skills }));
    } catch { setEmpSkills(prev => ({ ...prev, [key]: [] })); }
  };

  const rawCoverage = orgData?.skill_coverage;
  const skillCoverage = Array.isArray(rawCoverage)
    ? rawCoverage
    : rawCoverage ? Object.entries(rawCoverage).map(([skill_name, employee_count]) => ({ skill_name, employee_count })) : [];
  const employees = orgData?.employees || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Skill Matrix</h1>
        <p className="text-gray-500 text-sm mt-1">Track employee skills and proficiency levels</p>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        {[{ key: 'org', label: 'Org View' }, { key: 'my', label: 'My Skills' }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'org' && (
        orgLoading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div className="space-y-6">
            {skillCoverage.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" /> Skill Coverage</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Skill</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Employees</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Top Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {skillCoverage.map((s, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{s.skill_name}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1 text-gray-700">
                              <Users className="w-3 h-3" /> {s.employee_count}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${PROFICIENCY_COLORS[s.top_level] || 'bg-gray-100 text-gray-600'}`}>
                              {PROFICIENCY_LABELS[s.top_level] || s.top_level}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {employees.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4" /> Employees by Skill Count</CardTitle></CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-600">Skills</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {employees.map((emp, i) => {
                        const key = emp.user_id || emp.name;
                        const isExpanded = expandedEmp === key;
                        const skills = empSkills[key];
                        return (
                          <React.Fragment key={i}>
                            <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => loadEmpSkills(emp)}>
                              <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                <span className={`text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                {emp.name}
                              </td>
                              <td className="px-4 py-3 text-gray-600">{emp.department}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="inline-block bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 text-xs font-semibold">
                                  {emp.skill_count}
                                </span>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-blue-50/50">
                                <td colSpan={3} className="px-6 py-3">
                                  {!skills ? (
                                    <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading skills…</p>
                                  ) : skills.length === 0 ? (
                                    <p className="text-xs text-gray-400">No skills added yet.</p>
                                  ) : (
                                    <div className="flex flex-wrap gap-2">
                                      {skills.map((s, j) => (
                                        <span key={j} className={`text-xs px-2.5 py-1 rounded-full font-medium border ${PROFICIENCY_COLORS[s.proficiency_level] || 'bg-gray-100 text-gray-600'}`}>
                                          {s.skill_name} · {PROFICIENCY_LABELS[s.proficiency_level] || `L${s.proficiency_level}`}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {skillCoverage.length === 0 && employees.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Zap className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No skill data available yet.
              </div>
            )}
          </div>
        )
      )}

      {activeTab === 'my' && (
        myLoading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" /> Add Skill</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleAddSkill} className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-48">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Skill Name</label>
                    <input
                      type="text"
                      value={form.skill_name}
                      onChange={e => setForm(f => ({ ...f, skill_name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. React, Excel, Leadership..."
                    />
                  </div>
                  <div className="w-48">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Proficiency</label>
                    <Select value={form.proficiency_level} onValueChange={v => setForm(f => ({ ...f, proficiency_level: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4].map(l => (
                          <SelectItem key={l} value={String(l)}>{l} — {PROFICIENCY_LABELS[l]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={saving} className="flex items-center gap-2">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </Button>
                </form>
              </CardContent>
            </Card>

            {mySkills.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <Star className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No skills added yet. Add your first skill above.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {mySkills.map((s, i) => (
                  <Card key={i} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-semibold text-gray-900">{s.skill_name}</p>
                        <Star className="w-4 h-4 text-yellow-400 shrink-0" />
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${PROFICIENCY_COLORS[s.proficiency_level] || 'bg-gray-100 text-gray-600'}`}>
                        {PROFICIENCY_LABELS[s.proficiency_level] || `Level ${s.proficiency_level}`}
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
