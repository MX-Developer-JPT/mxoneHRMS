import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Users, ArrowDownCircle, ArrowUpCircle, RefreshCw, Search, Zap, CheckCircle, AlertCircle, Upload, ChevronDown, ChevronUp, AlarmClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import BiometricCodeMapping from '@/components/attendance/BiometricCodeMapping';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getISTDate = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

// Biometric devices send local IST time without any timezone offset.
// The backend stores the value as-is (Node on Railway/UTC just preserves the digits).
// So the stored string "2024-01-15T09:30:00.000Z" actually MEANS 09:30 IST —
// the Z suffix is misleading; treat the clock digits as IST directly.
// Strategy: strip any tz suffix, parse as UTC (to avoid browser local-tz interference),
// then read the UTC fields — those digits ARE the IST time.
function formatIST(raw) {
  if (!raw) return '-';
  try {
    const s = String(raw).trim().replace(' ', 'T');
    // Strip timezone marker so we read the raw clock digits
    const naive = s.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
    const d = new Date(naive + 'Z'); // parse as UTC to lock digits
    if (isNaN(d.getTime())) return raw;
    const dd   = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    let h      = d.getUTCHours();
    const min  = String(d.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${yyyy}, ${h}:${min} ${ampm} IST`;
  } catch { return raw; }
}

// Format a real UTC timestamp → IST display (for server-generated timestamps like ProcessedAt)
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatUTCtoIST(raw) {
  if (!raw) return '-';
  try {
    const d = new Date(raw); // real UTC parse
    if (isNaN(d.getTime())) return raw;
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    const dd   = String(ist.getUTCDate()).padStart(2, '0');
    let h      = ist.getUTCHours();
    const min  = String(ist.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${dd} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${h}:${min} ${ampm} IST`;
  } catch { return raw; }
}


const PAGE_SIZE = 200;

export default function AttendanceLogDashboard() {
  const [activeTab, setActiveTab] = useState('logs');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [empFilter, setEmpFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(getISTDate);
  const [dateTo, setDateTo] = useState(getISTDate);
  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  // Today's summary stats (always from server, regardless of current filter)
  const [todayPunches, setTodayPunches] = useState(0);
  const [todayEmployees, setTodayEmployees] = useState(0);

  const todayIST = getISTDate();
  const [processFrom, setProcessFrom] = useState(todayIST);
  const [processTo, setProcessTo] = useState(todayIST);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);

  // Manual import state
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);

  // Refs so auto-refresh closure always sees current state
  const filtersRef = useRef({ empFilter: '', dateFrom: getISTDate(), dateTo: getISTDate(), page: 1 });
  useEffect(() => { filtersRef.current = { empFilter, dateFrom, dateTo, page }; }, [empFilter, dateFrom, dateTo, page]);

  const loadLogs = useCallback(async (pg, filters) => {
    const f = filters || filtersRef.current;
    const p = pg ?? f.page;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getAttendanceLogs', {
        ...(f.dateFrom ? { date_from: f.dateFrom } : {}),
        ...(f.dateTo   ? { date_to:   f.dateTo   } : {}),
        ...(f.empFilter ? { emp_code: f.empFilter } : {}),
        page: p,
        limit: PAGE_SIZE,
      });
      const d = res.data;
      setLogs(d.logs || []);
      setPage(d.page);
      setTotalPages(d.pages || 1);
      setTotalRecords(d.total || 0);
      setTodayPunches(d.today_punches || 0);
      setTodayEmployees(d.today_employees || 0);
    } catch (err) {
      toast.error('Failed to load logs: ' + (err?.message || 'Unknown error'));
    }
    setLoading(false);
  }, []);

  // Debounce ref for emp filter text input
  const empDebounceRef = useRef(null);

  useEffect(() => {
    loadLogs(1, { empFilter, dateFrom, dateTo, page: 1 });
    const interval = setInterval(() => {
      const { empFilter: ef, dateFrom: df, dateTo: dt, page: pg } = filtersRef.current;
      loadLogs(pg, { empFilter: ef, dateFrom: df, dateTo: dt });
    }, 300000);
    return () => clearInterval(interval);
  }, []);

  const handleProcessToAttendance = async (extraPayload = {}) => {
    setProcessing(true);
    setProcessResult({ success: true, message: 'Starting…', in_progress: true });
    try {
      const res = await base44.functions.invoke('processEbioLogs', {
        date_from: processFrom,
        date_to: processTo,
        ...extraPayload,
      });
      const result = res.data;

      if (result?.status === 'processing' && result?.job_id) {
        // Server responded immediately — poll for completion
        await pollJob(result.job_id);
      } else {
        // Synchronous result (shouldn't happen after this deploy, but handle gracefully)
        applyProcessResult(result);
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to connect to server. Please try again.';
      toast.error(msg);
      setProcessResult({ success: false, message: msg });
      setProcessing(false);
    }
  };

  const pollJob = async (jobId) => {
    const MAX_POLLS = 150; // 5 minutes at 2s intervals
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await base44.functions.invoke('processEbioLogs', { job_id: jobId });
        const job = res.data;
        if (job?.status === 'done' || job?.status === 'error') {
          applyProcessResult(job.status === 'done' ? job : { success: false, message: job.error || 'Processing failed' });
          return;
        }
        // Still running — show live progress
        if (job?.progress) {
          setProcessResult({ success: true, message: job.progress, in_progress: true });
        }
      } catch (_e) {
        // Network hiccup — keep polling
      }
    }
    setProcessResult({ success: false, message: 'Processing is taking longer than expected. Check attendance records — data may have been saved partially.' });
    setProcessing(false);
  };

  const applyProcessResult = (result) => {
    setProcessResult(result);
    if (result?.success && result.records_synced > 0) {
      toast.success(`Synced ${result.records_synced} attendance record(s) successfully.`);
      loadLogs(1, { empFilter, dateFrom, dateTo });
    } else if (result?.success) {
      toast.info(result.message || 'Done.');
    } else {
      toast.error(result?.message || 'Processing failed.');
    }
    setProcessing(false);
  };

  const handleEmpFilterChange = (v) => {
    setEmpFilter(v);
    clearTimeout(empDebounceRef.current);
    empDebounceRef.current = setTimeout(() => loadLogs(1, { empFilter: v, dateFrom, dateTo }), 400);
  };

  const handleDateChange = (field, value) => {
    const newF = { empFilter, dateFrom, dateTo, [field]: value };
    if (field === 'dateFrom') setDateFrom(value);
    if (field === 'dateTo')   setDateTo(value);
    setPage(1);
    loadLogs(1, newF);
  };

  const handleClearFilters = () => {
    const today = getISTDate();
    setEmpFilter(''); setDateFrom(today); setDateTo(today); setPage(1);
    loadLogs(1, { empFilter: '', dateFrom: today, dateTo: today });
  };

  const goToPage = (pg) => { setPage(pg); loadLogs(pg, { empFilter, dateFrom, dateTo }); };

  const handleCloseOpenSessions = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const yesterday = new Date(Date.now() + IST_OFFSET_MS - 86400000).toISOString().slice(0, 10);
      const res = await base44.functions.invoke('closeOpenSessions', { date: yesterday });
      const result = res.data;
      setProcessResult(result);
      if (result?.success) {
        toast.success(`Auto-absent applied: ${result.closed || 0} open session(s) closed for ${result.date}`);
      } else {
        toast.error('Close open sessions failed');
      }
    } catch (err) {
      const msg = err?.message || 'Failed to close open sessions';
      toast.error(msg);
      setProcessResult({ success: false, message: msg });
    }
    setProcessing(false);
  };

  const handleReprocessLogs = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const res = await base44.functions.invoke('reprocessAttendanceLogs', {
        date_from: processFrom,
        date_to: processTo,
      });
      const result = res.data;
      setProcessResult(result);
      if (result?.success) {
        const msg = `Re-synced: ${result.attendance_updated || 0} updated, ${result.attendance_created || 0} created`;
        toast.success(msg);
        loadLogs(1, filtersRef.current);
      } else {
        toast.error(result?.error || 'Reprocess failed.');
      }
    } catch (err) {
      const msg = err?.message || 'Reprocess failed';
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
    setImportJson('');
    setShowImport(false);
    await handleProcessToAttendance({ raw_records: rawRecords });
  };

  const showingFrom = Math.min((page - 1) * PAGE_SIZE + 1, totalRecords);
  const showingTo   = Math.min(page * PAGE_SIZE, totalRecords);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Biometric Attendance Log</h1>
        <Button variant="outline" size="sm" onClick={() => loadLogs(page, { empFilter, dateFrom, dateTo })} disabled={loading}>
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
              <p className="text-2xl font-bold text-gray-800">{todayPunches.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="bg-green-100 p-3 rounded-full"><ArrowDownCircle className="w-6 h-6 text-green-600" /></div>
            <div>
              <p className="text-sm text-gray-500">Employees Present Today</p>
              <p className="text-2xl font-bold text-green-700">{todayEmployees.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 flex items-center gap-4">
            <div className="bg-purple-100 p-3 rounded-full"><ArrowUpCircle className="w-6 h-6 text-purple-600" /></div>
            <div>
              <p className="text-sm text-gray-500">Avg Punches / Employee</p>
              <p className="text-2xl font-bold text-purple-700">
                {todayEmployees > 0 ? (todayPunches / todayEmployees).toFixed(1) : '0'}
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
            Alternating punch model · 1st=In, 2nd=Out, 3rd=In… · Multiple sessions per day · Break time calculated · Dedup within 60s · No check-out by 5:30AM next day → <strong>Absent</strong>
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
            <Button onClick={handleReprocessLogs} disabled={processing} variant="outline" className="border-blue-400 text-blue-700 hover:bg-blue-100">
              {processing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Reprocessing...</> : <><CheckCircle className="w-4 h-4 mr-2" />Re-sync from Stored Logs</>}
            </Button>
            <Button onClick={handleCloseOpenSessions} disabled={processing} variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" title="Mark employees who checked in yesterday but never checked out as Absent">
              {processing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Processing...</> : <><AlarmClock className="w-4 h-4 mr-2" />Auto-Absent (5:30AM Rule)</>}
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
            <div className={`rounded-lg p-4 flex items-start gap-3 ${
              processResult.in_progress ? 'bg-blue-50 border border-blue-200'
              : processResult.success ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
            }`}>
              {processResult.in_progress
                ? <RefreshCw className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
                : processResult.success
                  ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  : <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              }
              <div className="text-sm">
                <p className={`font-semibold ${
                  processResult.in_progress ? 'text-blue-800'
                  : processResult.success ? 'text-green-800'
                  : 'text-red-800'
                }`}>{processResult.message}</p>
                {processResult.records_synced != null && (
                  <p className="text-green-700 text-xs mt-1">
                    {processResult.records_synced} attendance record(s) updated · {processResult.logs_stored || 0} new punch log(s) stored
                  </p>
                )}
                {processResult.warnings?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-orange-700 font-medium text-xs">Warnings ({processResult.warnings.length}):</p>
                    <ul className="list-disc list-inside text-orange-600 text-xs mt-1 space-y-0.5">
                      {processResult.warnings.slice(0, 15).map((w, i) => <li key={i}>{w}</li>)}
                      {processResult.warnings.length > 15 && <li>…and {processResult.warnings.length - 15} more</li>}
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
          <Input placeholder="Filter by Employee Code" value={empFilter} onChange={e => handleEmpFilterChange(e.target.value)} className="w-52" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">From:</label>
          <Input type="date" value={dateFrom} onChange={e => handleDateChange('dateFrom', e.target.value)} className="w-40" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">To:</label>
          <Input type="date" value={dateTo} onChange={e => handleDateChange('dateTo', e.target.value)} className="w-40" />
        </div>
        <Button variant="ghost" size="sm" onClick={handleClearFilters}>Today</Button>
        <div className="ml-auto flex items-center gap-3">
          {totalRecords > 0 && (
            <span className="text-sm text-gray-500">
              {totalRecords > PAGE_SIZE
                ? `${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} of ${totalRecords.toLocaleString()}`
                : `${totalRecords.toLocaleString()} records`}
            </span>
          )}
        </div>
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
            ) : logs.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No records found</td></tr>
            ) : logs.map(log => (
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
                <td className="px-4 py-3 text-gray-500 text-xs">{formatUTCtoIST(log.ProcessedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages} · {totalRecords.toLocaleString()} total records
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(1)}>
              «
            </Button>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {/* Page number pills — show up to 5 around current page */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              return start + i;
            }).map(pg => (
              <Button
                key={pg}
                variant={pg === page ? 'default' : 'outline'}
                size="sm"
                className="w-9"
                disabled={loading}
                onClick={() => goToPage(pg)}
              >
                {pg}
              </Button>
            ))}
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => goToPage(totalPages)}>
              »
            </Button>
          </div>
        </div>
      )}
    </>}
    </div>
  );
}