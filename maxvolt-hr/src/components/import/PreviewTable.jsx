import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function SheetTable({ title, rows, errors }) {
  const [open, setOpen] = useState(true);
  if (!rows || rows.length === 0) return null;

  const cols = Object.keys(rows[0]);
  const errorMap = {};
  errors.forEach(e => {
    const key = `${e.row}-${e.field}`;
    errorMap[key] = e.msg;
  });

  return (
    <div className="border rounded-lg overflow-hidden mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="font-medium text-sm text-gray-800">{title} <span className="text-gray-400">({rows.length} rows)</span></span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && (
        <div className="overflow-x-auto max-h-60">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-2 py-1 text-left text-gray-500 font-medium">#</th>
                {cols.map(c => (
                  <th key={c} className="px-2 py-1 text-left text-gray-700 font-medium whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1 text-gray-400">{ri + 2}</td>
                  {cols.map(c => {
                    const key = `${ri + 2}-${c}`;
                    const hasError = !!errorMap[key];
                    return (
                      <td
                        key={c}
                        title={hasError ? errorMap[key] : undefined}
                        className={`px-2 py-1 whitespace-nowrap ${hasError ? 'bg-red-100 text-red-700 font-medium' : 'text-gray-700'}`}
                      >
                        {String(row[c] ?? '')}
                        {hasError && <span className="ml-1 text-red-500 text-xs">⚠</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PreviewTable({ preview }) {
  const { errors = [] } = preview;

  const errsBySheet = {};
  errors.forEach(e => {
    if (!errsBySheet[e.sheet]) errsBySheet[e.sheet] = [];
    errsBySheet[e.sheet].push(e);
  });

  return (
    <div>
      <SheetTable title="Employee Profile" rows={preview.employee_profile} errors={errsBySheet['Employee_Profile'] || []} />
      <SheetTable title="Statutory Info" rows={preview.statutory_info} errors={errsBySheet['Statutory_Info'] || []} />
      <SheetTable title="Bank Details" rows={preview.bank_details} errors={errsBySheet['Bank_Details'] || []} />
      <SheetTable title="PF Nominee" rows={preview.pf_nominee} errors={errsBySheet['PF_Nominee'] || []} />
      <SheetTable title="Insurance Policies" rows={preview.insurance_policies} errors={errsBySheet['Insurance_Policies'] || []} />
      <SheetTable title="Salary Structure" rows={preview.salary_structure} errors={errsBySheet['Salary_Structure'] || []} />
      <SheetTable title="Leave Balances" rows={preview.leave_balances} errors={errsBySheet['Leave_Balances'] || []} />
    </div>
  );
}