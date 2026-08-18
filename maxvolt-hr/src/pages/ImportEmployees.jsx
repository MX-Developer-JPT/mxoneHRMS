import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import ImportUploadStep from '@/components/import/ImportUploadStep';
import ValidationSummary from '@/components/import/ValidationSummary';
import PreviewTable from '@/components/import/PreviewTable';
import ImportResultsDashboard from '@/components/import/ImportResultsDashboard';

const STEPS = ['Upload', 'Preview & Validate', 'Confirm & Import', 'Results'];

export default function ImportEmployees() {
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  if (!user) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const isAdmin = user.role === 'admin' || user.custom_role === 'admin';
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-center">
        <div>
          <p className="text-gray-500 text-lg">Access Denied</p>
          <p className="text-gray-400 text-sm mt-1">Only Admin users can access this page.</p>
        </div>
      </div>
    );
  }

  const handleFileSelect = async (selectedFile) => {
    setFile(selectedFile);
    setLoading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });
      setUploadedFileUrl(file_url);
      const res = await base44.functions.invoke('importEmployeeData', { fileUrl: file_url, mode: 'validate' });
      const data = res.data;
      if (data.error) throw new Error(data.error);
      setPreview(data);
      setStep(1);
    } catch (e) {
      alert('Failed to parse file: ' + (e.message || String(e)));
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!uploadedFileUrl) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('importEmployeeData', { fileUrl: uploadedFileUrl, mode: 'import' });
      const data = res.data;
      if (data.error) throw new Error(data.error);
      setImportResults(data);
      setStep(3);
    } catch (e) {
      alert('Import failed: ' + (e.message || String(e)));
    }
    setLoading(false);
  };

  const reset = () => {
    setStep(0);
    setFile(null);
    setPreview(null);
    setImportResults(null);
    setUploadedFileUrl(null);
  };

  const hasErrors = preview?.errors?.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-blue-100 p-2 rounded-lg">
          <FileSpreadsheet className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import Employees</h1>
          <p className="text-sm text-gray-500">Bulk import employee data from Excel — creates user accounts, salary structures, and leave balances instantly</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i < step ? 'bg-green-500 text-white' :
                i === step ? 'bg-blue-600 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden sm:block ${i === step ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < step ? 'bg-green-400' : 'bg-gray-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        {step === 0 && (
          <ImportUploadStep onFileSelect={handleFileSelect} loading={loading} />
        )}

        {step === 1 && preview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Preview & Validation</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className="font-medium text-gray-700">{preview.total_employees}</span> employees found
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">{preview.valid_count ?? 0} valid</span>
              <span className="px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">{preview.invalid_count ?? 0} invalid</span>
              <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-100">{preview.probation_to_confirmation_count ?? 0} will auto-confirm (probation → confirmation)</span>
            </div>
            <ValidationSummary errors={preview.errors || []} warnings={preview.warnings || []} />
            {preview.employees?.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 text-sm font-medium text-gray-800">Employee Preview (first {preview.employees.length} of {preview.valid_count ?? preview.total_employees})</div>
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">Code</th>
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">Name</th>
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">Email</th>
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">Department</th>
                        <th className="px-2 py-1 text-left text-gray-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.employees.map((e, i) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-2 py-1">{e.code}</td>
                          <td className="px-2 py-1">{e.name}</td>
                          <td className="px-2 py-1">{e.email}</td>
                          <td className="px-2 py-1">{e.department}</td>
                          <td className="px-2 py-1">
                            {e.employee_status}
                            {e.auto_confirmed && <span className="ml-1 text-purple-600">(auto)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <PreviewTable preview={preview} />
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={reset} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={() => setStep(2)} disabled={hasErrors} className="gap-2">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && preview && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Confirm Import</h2>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium text-blue-800">You are about to import:</p>
              <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
                <li><strong>{preview.total_employees}</strong> employee profiles</li>
                <li><strong>{preview.salary_structure?.length || 0}</strong> salary structures</li>
                <li><strong>{preview.leave_balances?.length || 0}</strong> leave balance records</li>
                <li><strong>{preview.insurance_policies?.length || 0}</strong> insurance policy records</li>
              </ul>
              <p className="text-sm text-blue-700 mt-2">
                Employee <strong>user accounts will be created immediately</strong> with all records (profile, salary, bank details, leave balances) linked. Each employee gets a temporary default password.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800">Default Password for all imported employees:</p>
              <p className="text-lg font-mono font-bold text-amber-900 mt-1">Maxvolt@1234</p>
              <p className="text-xs text-amber-700 mt-1">Employees will be forced to change this password on first login.</p>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back to Preview
              </Button>
              <Button onClick={handleImport} disabled={loading} className="gap-2 bg-green-600 hover:bg-green-700">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {loading ? 'Importing...' : 'Confirm & Import'}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && importResults && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Import Complete</h2>
              <Button variant="outline" onClick={reset} size="sm">Start New Import</Button>
            </div>
            {(() => {
              const s = importResults.summary || {};
              const metrics = [
                { label: 'Total Processed', value: s.total_records_processed ?? importResults.total ?? 0, color: 'gray' },
                { label: 'New Employees Created', value: s.new_employees_created ?? importResults.created ?? 0, color: 'green' },
                { label: 'Existing Employees Updated', value: s.existing_employees_updated ?? 0, color: 'blue' },
                { label: 'No Changes Needed', value: s.employees_no_change ?? 0, color: 'gray' },
                { label: 'Probation → Confirmation', value: s.probation_to_confirmation_count ?? 0, color: 'purple' },
                { label: 'New User Accounts', value: s.new_user_accounts_created ?? 0, color: 'green' },
                { label: 'User Accounts Synced', value: s.existing_user_accounts_synchronised ?? 0, color: 'blue' },
                { label: 'Duplicates Detected', value: s.duplicate_records_detected ?? 0, color: 'amber' },
                { label: 'Validation Failures', value: s.validation_failures ?? 0, color: 'red' },
                { label: 'Records Skipped', value: s.records_skipped ?? importResults.failed ?? 0, color: 'red' },
                { label: 'Bank Details Created', value: s.bank_details_created ?? 0, color: 'green' },
                { label: 'Bank Details Updated', value: s.bank_details_updated ?? 0, color: 'blue' },
                { label: 'Salary Structure Created', value: s.salary_structure_created ?? 0, color: 'green' },
                { label: 'Salary Structure Updated', value: s.salary_structure_updated ?? 0, color: 'blue' },
                { label: 'Promoted to Manager', value: s.managers_promoted ?? 0, color: 'purple' },
              ];
              const colorClasses = {
                gray: 'bg-gray-50 border-gray-100 text-gray-700',
                green: 'bg-green-50 border-green-100 text-green-700',
                blue: 'bg-blue-50 border-blue-100 text-blue-700',
                purple: 'bg-purple-50 border-purple-100 text-purple-700',
                amber: 'bg-amber-50 border-amber-100 text-amber-700',
                red: 'bg-red-50 border-red-100 text-red-700',
              };
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {metrics.map((m) => (
                    <div key={m.label} className={`border rounded-lg p-4 text-center ${colorClasses[m.color]}`}>
                      <p className="text-2xl font-bold">{m.value}</p>
                      <p className="text-xs mt-1">{m.label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800">Share with employees:</p>
              <p className="text-sm text-amber-700 mt-1">Login URL: <strong>{window.location.origin}/login</strong></p>
              <p className="text-sm text-amber-700">Default Password: <strong className="font-mono">Maxvolt@1234</strong></p>
              <p className="text-xs text-amber-600 mt-1">Each employee will be prompted to set their own password on first login.</p>
            </div>
            {(importResults.errors || []).length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-700 mb-2">Errors ({importResults.errors.length}):</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {importResults.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-1.5">
                      {e.message || `Row ${e.row}: ${e.field || ''}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(importResults.results || []).filter(r => r.status === 'error').length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-700 mb-2">Skipped rows:</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(importResults.results || []).filter(r => r.status === 'error').map((r, i) => (
                    <div key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-3 py-1.5">
                      {r.name} ({r.code}): {r.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading && step === 0 && (
          <div className="flex items-center justify-center py-8 gap-2 text-blue-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Parsing and validating file...</span>
          </div>
        )}
      </div>
    </div>
  );
}