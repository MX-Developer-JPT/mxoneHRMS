import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Users, ArrowDownCircle, ArrowUpCircle, RefreshCw, Search, Zap, CheckCircle, AlertCircle, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { isToday } from 'date-fns';
import { toast } from 'sonner';
import BiometricCodeMapping from '@/components/attendance/BiometricCodeMapping';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Display a UTC ISO string in IST
// All LogDate values stored in DB are UTC ISO strings (with or without trailing Z).
// Force parse as UTC by ensuring a Z suffix before converting to IST.
function formatIST(utcStr) {
  if (!utcStr) return '-';
  try {
    const s = String(utcStr).trim();
    // Ensure we parse as UTC: append Z if no timezone marker present
    const forceUTC = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
    const utc = new Date(forceUTC);
    if (isNaN(utc.getTime())) return utcStr;
    const ist = new Date(utc.getTime() + IST_OFFSET_MS);
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    const yyyy = ist.getUTCFullYear();
    let h = ist.getUTCHours();
    const min = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()]} ${yyyy}, ${h}:${min} ${ampm} IST`;
  } catch { return utcStr; }
}

// Check if a date string falls on today in IST
function isTodayIST(dateStr) {
  try {
    if (!dateStr) return false;
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(String(dateStr).trim());
    const todayIST = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    if (hasTimezone) {
      const ist = new Date(new Date(dateStr).getTime() + IST_OFFSET_MS);
      return ist.toISOString().slice(0, 10) === todayIST;
    } else {
      return String(dateStr).trim().slice(0, 10) === todayIST;
    }
  } catch { return false; }
}

export default function AttendanceLogDashboard() {
  const [activeTab, setActiveTab] = useState('logs');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [empFilter, setEmpFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const todayIST = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const [processFrom, setProcessFrom] = useState(todayIST);
  const [processTo, setProcessTo] = useState(todayIST);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);

  // Manual import state
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    const data = await base44.entities.AttendanceLog.list('-LogDate', 10000);
    setLogs(data);
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, []);

  const handleProcessToAttendance = async (extraPayload = {}) => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const res = await base44.functions.invoke('processEbioLogs', {
        date_from: processFrom,
        date_to: processTo,
        ...extraPayload,
      });
      const result = res.data;
      setProcessResult(result);
      if (result?.success && result.records_synced > 0) {
        toast.success(`Synced ${result.records_synced} attendance record(s) successfully.`);
        loadLogs();
      } else if (result?.success) {
        toast.info(result.message);
      } else {
        toast.error('Processing failed.');
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Processing failed due to a server error. Please try again.';
      toast.error(msg);
      setProcessResult({ success: false, message: msg });
    }
    setProcessing(false);
  };

  // Parse TSV/CSV into records with normalised keys
  const parseTSV = (text) => {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''));
    const aliasMap = {
      'log date': 'LogDate', 'logdate': 'LogDate', 'punch time': 'LogDate', 'attendance date': 'LogDate',
      'date/time': 'LogDate', 'datetime': 'LogDate', 'punch date/time': 'LogDate',
      'employee code': 'EmployeeCode', 'emp code': 'EmployeeCode', 'enroll no': 'EmployeeCode',
      'enroll number': 'EmployeeCode', 'employee id': 'EmployeeCode', 'pin': 'EmployeeCode',
      'device name': 'DeviceName', 'machine name': 'DeviceName',
      'direction': 'Direction', 'in/out': 'Direction', 'punch type': 'Direction',
      'employee name': 'EmployeeName', 'verification type': 'VerificationType',
      'work code': 'WorkCode', 'location': 'GPS',
    };
    return lines.slice(1).map(line => {
      const vals = line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''));
      const raw = {};
      headers.forEach((h, i) => { raw[h] = vals[i] || ''; });

      // Map to normalised keys
      const obj = {};
      headers.forEach((h, i) => { obj[aliasMap[h.toLowerCase()] || h] = vals[i] || ''; });

      // Handle eBioServer format with separate Date + Time columns
      // e.g. columns: "Date", "Time" OR "Attendance Date", "Punch Time"
      const dateCol = headers.find(h => /^(attendance\s*)?date$/i.test(h.trim()));
      const timeCol = headers.find(h => /^(punch\s*)?time$/i.test(h.trim()));
      if (dateCol && timeCol && !obj.LogDate) {
        const datePart = raw[dateCol];
        const timePart = raw[timeCol];
        if (datePart && timePart) obj.LogDate = `${datePart} ${timePart}`;
      } else if (dateCol && timeCol && obj.LogDate) {
        // LogDate might only have the date — if it looks date-only, combine with time
        const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$|^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(obj.LogDate?.trim());
        if (dateOnlyMatch && raw[timeCol]) obj.LogDate = `${obj.LogDate} ${raw[timeCol]}`;
      }

      return obj;
    });
  };

  const handleManualImport = async () => {
    const text = importJson.trim();
    let rawRecords;

    // Try JSON first
    if (text.startsWith('[') || text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        rawRecords = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        toast.error('Invalid JSON. Please paste valid JSON or TSV from eBioServer.');
        return;
      }
    } else {
      // Try TSV/CSV
      rawRecords = parseTSV(text);
      if (!rawRecords || rawRecords.length === 0) {
        toast.error('Could not parse data. Paste JSON or tab-separated data from eBioServer.');
        return;
      }
    }

    if (rawRecords.length === 0) {
      toast.error('No records found in pasted data.');
      return;
    }
    setImporting(true);
    await handleProcessToAttendance({ raw_records: rawRecords });
    setImporting(false);
    setImportJson('');
    setShowImport(false);
  };

  const getLogISTDate = (logDate) => {
    if (!logDate) return '';
    try {
      const s = String(logDate).trim();
      // All stored LogDates are UTC — force UTC parse then convert to IST
      const forceUTC = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
      const d = new Date(forceUTC);
      if (isNaN(d.getTime())) return '';
      return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    } catch { return ''; }
  };

  const filtered = logs.filter(log => {
    if (empFilter && !log.EmployeeCode?.toLowerCase().includes(empFilter.toLowerCase())) return false;
    if (dateFrom || dateTo) {
      const logISTDate = getLogISTDate(log.LogDate);
      if (!logISTDate) return true; // don't filter out logs with unparseable dates
      if (dateFrom && logISTDate < dateFrom) return false;
      if (dateTo && logISTDate > dateTo) return false;
    }
    return true;
  });

  const todayLogs = logs.filter(log => isTodayIST(log.LogDate));
  const todayPresentEmployees = new Set(todayLogs.map(l => l.EmployeeCode)).size;
  const todayTotalCount = todayLogs.length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Biometric Attendance Log</h1>
        <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-0">
        {[
          { key: 'logs', label: 'Punch Logs' },
          { key: 'mapping', label: 'Employee Code Mapping' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'mapping' && <BiometricCodeMapping />}
      {activeTab !== 'mapping' && <>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="bg-blue-100 p-3 rounded-full"><Users className="w-6 h-6 text-blue-600" /></div>
            <div>
              <p className="text-sm text-gray-500">Today's Total Punches</p>
              <p className="text-2xl font-bold text-gray-800">{todayTotalCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="bg-green-100 p-3 rounded-full"><ArrowDownCircle className="w-6 h-6 text-green-600" /></div>
            <div>
              <p className="text-sm text-gray-500">Employees Present Today</p>
              <p className="text-2xl font-bold text-green-700">{todayPresentEmployees}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="bg-purple-100 p-3 rounded-full"><ArrowUpCircle className="w-6 h-6 text-purple-600" /></div>
            <div>
              <p className="text-sm text-gray-500">Avg Punches / Employee</p>
              <p className="text-2xl font-bold text-purple-700">
                {todayPresentEmployees > 0 ? (todayTotalCount / todayPresentEmployees).toFixed(1) : '0'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Process to Attendance Module */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-blue-800">
            <Zap className="w-5 h-5" />
            Process Biometric Logs → Attendance Records
          </CardTitle>
          <p className="text-sm text-blue-600">
            Sequential IN/OUT cycle · <strong>&lt;3h = Absent</strong> · <strong>3–9h = Half Day</strong> · <strong>≥9h = Present</strong> · First punch = Check-In (immediate Present) · Late &gt;20 min = warning · 3 late days/month → all late days → Half Day
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">From Date</label>
              <Input type="date" value={processFrom} onChange={e => setProcessFrom(e.target.value)} className="w-40 bg-white" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">To Date</label>
              <Input type="date" value={processTo} onChange={e => setProcessTo(e.target.value)} className="w-40 bg-white" />
            </div>
            <Button onClick={() => handleProcessToAttendance()} disabled={processing} className="bg-blue-600 hover:bg-blue-700 text-white">
              {processing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Processing...</> : <><Zap className="w-4 h-4 mr-2" />Process to Attendance</>}
            </Button>
          </div>

          {/* Manual Import from eBioServer */}
          <div className="border-t border-blue-200 pt-3">
            <button
              className="flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
              onClick={() => setShowImport(v => !v)}
            >
              <Upload className="w-4 h-4" />
              Manually import punch data from eBioServer (paste JSON)
              {showImport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showImport && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-500">
                  Paste attendance data from eBioServer — accepts <strong>tab-separated (TSV)</strong>, CSV, or JSON format. Dates are treated as IST automatically.
                </p>
                <Textarea
                  placeholder={"Date\tTime\tEmployee Code\tEmployee Name\tDevice Name\tDirection\n2026-05-11\t09:15:00\tE001\tJohn Doe\tMain Gate\tIN\n2026-05-11\t18:30:00\tE001\tJohn Doe\tMain Gate\tOUT\n\nOR paste as combined: Log Date\tEmployee Code...\n2026-05-11 09:15:00\tE001\t..."}
                  value={importJson}
                  onChange={e => setImportJson(e.target.value)}
                  className="font-mono text-xs h-36 bg-white"
                />
                <div className="flex gap-2">
                  <Button onClick={handleManualImport} disabled={importing || !importJson.trim()} className="bg-green-600 hover:bg-green-700 text-white">
                    {importing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Importing...</> : <><Upload className="w-4 h-4 mr-2" />Import & Process</>}
                  </Button>
                  <Button variant="ghost" onClick={() => { setImportJson(''); setShowImport(false); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {processResult && (
            <div className={`rounded-lg p-4 flex items-start gap-3 ${processResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {processResult.success
                ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              }
              <div className="text-sm">
                <p className={`font-semibold ${processResult.success ? 'text-green-800' : 'text-red-800'}`}>{processResult.message}</p>
                {processResult.warnings?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-orange-700 font-medium text-xs">Warnings ({processResult.warnings.length}):</p>
                    <ul className="list-disc list-inside text-orange-600 text-xs mt-1 space-y-0.5">
                      {processResult.warnings.slice(0, 15).map((w, i) => <li key={i}>{w}</li>)}
                      {processResult.warnings.length > 15 && <li>...and {processResult.warnings.length - 15} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400" />
          <Input placeholder="Filter by Employee Code" value={empFilter} onChange={e => setEmpFilter(e.target.value)} className="w-52" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">From:</label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">To:</label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
        </div>
        {(empFilter || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setEmpFilter(''); setDateFrom(''); setDateTo(''); }}>Clear</Button>
        )}
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-4 py-3 text-left">Employee Code</th>
              <th className="px-4 py-3 text-left">Log Date & Time (IST)</th>
              <th className="px-4 py-3 text-left">Direction</th>
              <th className="px-4 py-3 text-left">Device</th>
              <th className="px-4 py-3 text-left">Verification</th>
              <th className="px-4 py-3 text-left">Received At</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No records found</td></tr>
            ) : filtered.map(log => (
              <tr key={log.id} className="border-t hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800">{log.EmployeeCode}</td>
                <td className="px-4 py-3 text-gray-700">{formatIST(log.LogDate)}</td>
                <td className="px-4 py-3">
                  {log.Direction === 'IN' ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200"><ArrowDownCircle className="w-3 h-3 mr-1" /> IN</Badge>
                  ) : log.Direction === 'OUT' ? (
                    <Badge className="bg-red-100 text-red-700 border-red-200"><ArrowUpCircle className="w-3 h-3 mr-1" /> OUT</Badge>
                  ) : log.Direction === 'INOUT' ? (
                    <Badge className="bg-purple-100 text-purple-700 border-purple-200">INOUT</Badge>
                  ) : (
                    <Badge variant="outline">{log.Direction || '-'}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{log.DeviceName || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{log.VerificationType || '-'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatIST(log.ProcessedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>}
    </div>
  );
}