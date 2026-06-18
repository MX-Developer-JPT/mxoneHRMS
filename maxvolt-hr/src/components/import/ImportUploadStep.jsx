import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Download, Loader2 } from 'lucide-react';

export default function ImportUploadStep({ onFileSelect, loading }) {
  const inputRef = useRef();
  const [downloading, setDownloading] = useState(false);

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      const res = await base44.functions.invoke('generateEmployeeTemplate', {});
      const { base64, filename } = res.data;

      // Decode base64 to binary and trigger download
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      alert('Could not download template: ' + e.message);
    }
    setDownloading(false);
  };

  const handleChange = (e) => {
    const file = e.target.files[0];
    if (file) onFileSelect(file);
  };

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      <div className="bg-blue-50 rounded-full p-6">
        <FileSpreadsheet className="w-12 h-12 text-blue-600" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-gray-800">Bulk Import Employees</h2>
        <p className="text-gray-500 mt-1 text-sm max-w-md">
          Download the template, fill in employee data across all sheets, then upload to import.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="outline"
          onClick={handleDownloadTemplate}
          disabled={downloading}
          className="gap-2"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download Template
        </Button>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Upload Filled Excel
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleChange}
      />
      <p className="text-xs text-gray-400">Accepted formats: .xlsx, .xls</p>
    </div>
  );
}