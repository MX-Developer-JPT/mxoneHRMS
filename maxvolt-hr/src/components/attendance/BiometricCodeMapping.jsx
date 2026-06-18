import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, AlertCircle, RefreshCw, Link, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function BiometricCodeMapping() {
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [search, setSearch] = useState('');
  // bioCode -> selected employee id
  const [assignments, setAssignments] = useState({});

  const load = async () => {
    setLoading(true);
    const [logData, empData] = await Promise.all([
      base44.entities.AttendanceLog.list('-LogDate', 5000),
      base44.entities.Employee.list(),
    ]);
    setLogs(logData);
    setEmployees(empData);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Collect unique biometric codes from logs
  const uniqueCodes = [...new Set(logs.map(l => String(l.EmployeeCode || '').trim()).filter(Boolean))].sort();

  // Build lookup maps
  const biometricIdMap = {}; // biometric_id (lower) -> emp
  const empCodeMap = {};     // employee_code (lower) -> emp
  for (const emp of employees) {
    if (emp.biometric_id) biometricIdMap[String(emp.biometric_id).trim().toLowerCase()] = emp;
    if (emp.employee_code) empCodeMap[String(emp.employee_code).trim().toLowerCase()] = emp;
  }

  const getMatch = (code) => {
    const lower = code.toLowerCase();
    return biometricIdMap[lower] || empCodeMap[lower] || null;
  };

  const handleAssign = async (bioCode, employeeId) => {
    if (!employeeId) return;
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;
    setSaving(s => ({ ...s, [bioCode]: true }));
    try {
      await base44.entities.Employee.update(employeeId, { biometric_id: String(bioCode) });
      toast.success(`Biometric code "${bioCode}" mapped to ${emp.display_name || emp.employee_code}`);
      await load();
      setAssignments(a => { const n = { ...a }; delete n[bioCode]; return n; });
    } catch (e) {
      toast.error('Failed to save mapping: ' + e.message);
    }
    setSaving(s => ({ ...s, [bioCode]: false }));
  };

  const filtered = uniqueCodes.filter(c =>
    !search || c.toLowerCase().includes(search.toLowerCase())
  );

  const unmappedCount = uniqueCodes.filter(c => !getMatch(c)).length;
  const mappedCount = uniqueCodes.length - unmappedCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-3">
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle className="w-3 h-3 mr-1" /> {mappedCount} Mapped
          </Badge>
          <Badge className="bg-red-100 text-red-700 border-red-200">
            <AlertCircle className="w-3 h-3 mr-1" /> {unmappedCount} Unmapped
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search biometric code..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-52"
        />
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400">No biometric codes found in logs.</div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">eBioServer Code</th>
                <th className="px-4 py-3 text-left">Punch Count</th>
                <th className="px-4 py-3 text-left">Mapped Employee</th>
                <th className="px-4 py-3 text-left">Match Via</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(code => {
                const match = getMatch(code);
                const punchCount = logs.filter(l => String(l.EmployeeCode || '').trim() === code).length;
                const matchVia = match
                  ? (biometricIdMap[code.toLowerCase()] ? 'biometric_id' : 'employee_code')
                  : null;
                const selectedEmpId = assignments[code] || '';

                return (
                  <tr key={code} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-gray-800">{code}</td>
                    <td className="px-4 py-3 text-gray-600">{punchCount}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {match ? (
                        <span>{match.display_name || match.employee_code}</span>
                      ) : (
                        <span className="text-gray-400 italic">Not mapped</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {matchVia && (
                        <Badge variant="outline" className="text-xs">
                          {matchVia === 'biometric_id' ? '🎯 biometric_id' : '🔁 employee_code'}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {match ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          <CheckCircle className="w-3 h-3 mr-1" /> Matched
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 border-red-200">
                          <AlertCircle className="w-3 h-3 mr-1" /> Unmatched
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!match && (
                        <div className="flex items-center gap-2">
                          <select
                            className="border rounded px-2 py-1 text-sm text-gray-700 bg-white max-w-[200px]"
                            value={selectedEmpId}
                            onChange={e => setAssignments(a => ({ ...a, [code]: e.target.value }))}
                          >
                            <option value="">-- Select Employee --</option>
                            {employees
                              .sort((a, b) => (a.display_name || a.employee_code || '').localeCompare(b.display_name || b.employee_code || ''))
                              .map(emp => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.display_name || emp.employee_code} ({emp.employee_code})
                                </option>
                              ))}
                          </select>
                          <Button
                            size="sm"
                            disabled={!selectedEmpId || saving[code]}
                            onClick={() => handleAssign(code, selectedEmpId)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            {saving[code]
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <><Link className="w-3 h-3 mr-1" />Map</>
                            }
                          </Button>
                        </div>
                      )}
                      {match && matchVia === 'employee_code' && (
                        <span className="text-xs text-gray-400">Set biometric_id to improve matching</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}