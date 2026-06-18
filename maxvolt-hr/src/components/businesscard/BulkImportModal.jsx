import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, CheckCircle, XCircle, Loader2 } from 'lucide-react';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 7);
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

export default function BulkImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [importing, setImporting] = useState(false);

  const handleDownloadTemplate = () => {
    const csv = `Name,Job Title,Company,Phone Number,Email,WhatsApp Number,Website,LinkedIn URL,Address,Profile Picture URL
John Doe,Software Engineer,Acme Corp,+91 98765 43210,john@acme.com,+91 98765 43210,https://acme.com,,Mumbai India,
Jane Smith,HR Manager,Tech Ltd,+91 98765 43211,jane@tech.com,,,https://linkedin.com/in/jane,Delhi India,`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'business_card_template.csv';
    a.click();
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setResults(null);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    const text = await file.text();
    const rows = parseCsv(text);
    const res = { success: 0, failed: 0, errors: [] };

    for (const row of rows) {
      const name = row.name || row.full_name || '';
      if (!name || !row.email) {
        res.failed++;
        res.errors.push(`Row missing name or email`);
        continue;
      }
      try {
        await base44.entities.DigitalBusinessCard.create({
          name,
          job_title: row.job_title || '',
          company: row.company || '',
          phone_number: row.phone_number || row.phone || '',
          email: row.email,
          whatsapp_number: row.whatsapp_number || '',
          website: row.website || '',
          linkedin_url: row.linkedin_url || '',
          address: row.address || '',
          profile_picture_url: row.profile_picture_url || '',
          unique_slug: generateSlug(name),
        });
        res.success++;
      } catch (e) {
        res.failed++;
        res.errors.push(`${name}: ${e.message}`);
      }
    }

    setResults(res);
    setImporting(false);
    if (res.success > 0) setTimeout(onImported, 1500);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Import Business Cards</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            Upload a CSV file with employee details. Download the template to get started.
          </div>

          <Button variant="outline" className="w-full gap-2" onClick={handleDownloadTemplate}>
            <Download className="w-4 h-4" /> Download CSV Template
          </Button>

          <label className="block border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">{file ? file.name : 'Click to upload CSV'}</p>
            <p className="text-xs text-gray-400 mt-1">CSV files only</p>
            <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </label>

          {results && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>{results.success} card(s) imported successfully</span>
              </div>
              {results.failed > 0 && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <XCircle className="w-4 h-4" />
                  <span>{results.failed} failed</span>
                </div>
              )}
              {results.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-500 pl-6">{e}</p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleImport} disabled={!file || importing} className="flex-1">
              {importing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}