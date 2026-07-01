import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, Eye, Plus, Search, User, ChevronDown, ChevronRight, Download, FolderDown, X, Filter, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import DocViewerModal from '@/components/DocViewerModal';
import { toast } from 'sonner';
import { safeDate } from '@/lib/dateUtils';

const documentTypes = [
  { value: 'aadhar',           label: 'Aadhar Card' },
  { value: 'pan',              label: 'PAN Card' },
  { value: 'passport',         label: 'Passport' },
  { value: 'driving_license',  label: 'Driving License' },
  { value: 'educational',      label: 'Educational Certificate' },
  { value: 'experience_letter',label: 'Experience Letter' },
  { value: 'offer_letter',     label: 'Offer Letter' },
  { value: 'contract',         label: 'Employment Contract' },
  { value: 'hr_letter',        label: 'HR Letter (Generated)' },
  { value: 'other',            label: 'Other' },
];

const statusColors = {
  pending_verification: 'bg-yellow-100 text-yellow-800',
  verified:             'bg-green-100 text-green-800',
  rejected:             'bg-red-100 text-red-800',
  expired:              'bg-gray-100 text-gray-800',
};

export default function EmployeeDocuments() {
  const [employees,        setEmployees]        = useState([]);
  const [users,            setUsers]            = useState([]);
  const [allDocuments,     setAllDocuments]     = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [search,           setSearch]           = useState('');
  const [expandedEmployee, setExpandedEmployee] = useState(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [uploading,        setUploading]        = useState(false);
  const [formData,         setFormData]         = useState({ document_type:'', document_name:'', expiry_date:'' });
  const [selectedFile,     setSelectedFile]     = useState(null);
  const [currentUser,      setCurrentUser]      = useState(null);
  const [viewerDoc,        setViewerDoc]        = useState(null);

  // Bulk download filters
  const [bulkEmpFilter,  setBulkEmpFilter]  = useState('');  // user_id or ''
  const [bulkTypeFilter, setBulkTypeFilter] = useState('');  // doc type or ''
  const [downloading,    setDownloading]    = useState(false);
  const [showBulkPanel,  setShowBulkPanel]  = useState(false);
  const [bulkEmpOpen, setBulkEmpOpen] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const me = await base44.auth.me();
      setCurrentUser(me);
      const usersResponse = await base44.functions.invoke('getAllUsers', {});
      const allUsers = usersResponse?.data?.users || usersResponse?.users || [];
      const empRecords = await base44.entities.Employee.list('-created_date', 500);
      const docs = await base44.entities.Document.list('-created_date', 1000);
      setUsers(allUsers);
      setEmployees(empRecords);
      setAllDocuments(docs);
    } catch (err) { console.error('Error loading data:', err); }
    setLoading(false);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) { toast.error('Please select a file'); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });
      await base44.entities.Document.create({
        ...formData,
        user_id: selectedEmployee.userId,
        document_url: file_url,
        uploaded_by: currentUser.id,
        status: 'pending_verification',
      });
      toast.success('Document uploaded successfully');
      setShowUploadDialog(false);
      setFormData({ document_type:'', document_name:'', expiry_date:'' });
      setSelectedFile(null);
      loadData();
    } catch { toast.error('Failed to upload document'); }
    setUploading(false);
  };

  const handleVerifyStatus = async (docId, newStatus) => {
    await base44.entities.Document.update(docId, { status: newStatus });
    toast.success(`Document marked as ${newStatus.replace('_', ' ')}`);
    loadData();
  };

  const getUserName = (userId) => {
    const emp = employees.find(e => e.user_id === userId);
    if (emp?.display_name) return emp.display_name;
    const u = users.find(u => u.id === userId);
    return u ? (u.display_name || u.full_name || u.email) : 'Unknown';
  };

  // Count documents matching bulk filter
  const bulkMatchCount = (() => {
    let docs = allDocuments.filter(d => d.document_url);
    if (bulkEmpFilter)  docs = docs.filter(d => d.user_id === bulkEmpFilter);
    if (bulkTypeFilter) docs = docs.filter(d => d.document_type === bulkTypeFilter);
    return docs.length;
  })();

  const handleBulkDownload = async () => {
    if (!bulkMatchCount) { toast.error('No documents match the selected filters'); return; }
    setDownloading(true);
    try {
      const params = {};
      if (bulkEmpFilter)  params.user_ids       = [bulkEmpFilter];
      if (bulkTypeFilter) params.document_types  = [bulkTypeFilter];
      const res = await base44.functions.invoke('bulkDownloadDocuments', params);
      const d = res?.data ?? res;
      if (d?.base64) {
        const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = d.filename || 'documents.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(`Downloaded ${d.total} document${d.total !== 1 ? 's' : ''}`);
      } else {
        toast.error(d?.error || 'Download failed — no data returned');
      }
    } catch (e) { toast.error('Download failed: ' + (e.message || e)); }
    setDownloading(false);
  };

  const activeEmployees = employees.filter(e => e.status !== 'resigned' && e.status !== 'terminated');

  const filteredEmployees = activeEmployees.filter(emp => {
    const name = getUserName(emp.user_id).toLowerCase();
    const code = (emp.employee_code || '').toLowerCase();
    const dept = (emp.department || '').toLowerCase();
    const q = search.toLowerCase();
    return !q || name.includes(q) || code.includes(q) || dept.includes(q);
  });

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Employee Documents</h1>
            <p className="text-gray-600 mt-1">View and manage documents for all employees</p>
          </div>
          <Button
            variant={showBulkPanel ? 'default' : 'outline'}
            onClick={() => setShowBulkPanel(v => !v)}
            className="gap-2"
          >
            <FolderDown className="w-4 h-4" />
            Bulk Download
          </Button>
        </div>

        {/* Bulk Download Panel */}
        {showBulkPanel && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-xs font-medium text-gray-600 mb-1 block">Employee (optional)</Label>
                  <Popover open={bulkEmpOpen} onOpenChange={setBulkEmpOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-sm h-9 hover:bg-accent">
                        <span className={bulkEmpFilter ? 'text-foreground' : 'text-muted-foreground'}>
                          {bulkEmpFilter ? (() => { const e = activeEmployees.find(e => e.user_id === bulkEmpFilter); return e ? `${getUserName(e.user_id)}${e.employee_code ? ` (${e.employee_code})` : ''}` : 'All employees'; })() : 'All employees'}
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
                            <CommandItem value="all employees" onSelect={() => { setBulkEmpFilter(''); setBulkEmpOpen(false); }}>
                              <Check className={`mr-2 h-4 w-4 ${!bulkEmpFilter ? 'opacity-100' : 'opacity-0'}`} />
                              All employees
                            </CommandItem>
                            {activeEmployees.map(emp => (
                              <CommandItem
                                key={emp.user_id}
                                value={`${getUserName(emp.user_id)} ${emp.employee_code || ''} ${emp.department || ''}`}
                                onSelect={() => { setBulkEmpFilter(emp.user_id); setBulkEmpOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${bulkEmpFilter === emp.user_id ? 'opacity-100' : 'opacity-0'}`} />
                                <div>
                                  <p className="font-medium">{getUserName(emp.user_id)}</p>
                                  <p className="text-xs text-muted-foreground">{emp.employee_code} · {emp.department}</p>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex-1 min-w-[180px]">
                  <Label className="text-xs font-medium text-gray-600 mb-1 block">Document Type (optional)</Label>
                  <Select value={bulkTypeFilter} onValueChange={setBulkTypeFilter}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All types</SelectItem>
                      {documentTypes.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end gap-2">
                  <div className="text-sm text-gray-600 pb-1">
                    <span className="font-semibold text-blue-700">{bulkMatchCount}</span> doc{bulkMatchCount !== 1 ? 's' : ''} match
                  </div>
                  <Button
                    onClick={handleBulkDownload}
                    disabled={downloading || !bulkMatchCount}
                    className="gap-2 bg-blue-600 hover:bg-blue-700"
                  >
                    <Download className="w-4 h-4" />
                    {downloading ? 'Preparing ZIP…' : 'Download ZIP'}
                  </Button>
                  {(bulkEmpFilter || bulkTypeFilter) && (
                    <Button variant="ghost" size="sm" onClick={() => { setBulkEmpFilter(''); setBulkTypeFilter(''); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            className="pl-10"
            placeholder="Search by name, employee code or department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Employee list */}
        <div className="space-y-4">
          {filteredEmployees.map(emp => {
            const empDocs  = allDocuments.filter(d => d.user_id === emp.user_id);
            const isExpanded = expandedEmployee === emp.id;
            const name = getUserName(emp.user_id);

            return (
              <Card key={emp.id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedEmployee(isExpanded ? null : emp.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold">{name}</p>
                      <p className="text-sm text-gray-500">{emp.employee_code} · {emp.department} · {emp.designation}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{empDocs.length} doc{empDocs.length !== 1 ? 's' : ''}</Badge>
                    <Button
                      size="sm"
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedEmployee({ userId: emp.user_id, name });
                        setFormData({ document_type:'', document_name:'', expiry_date:'' });
                        setSelectedFile(null);
                        setShowUploadDialog(true);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Upload
                    </Button>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="border-t bg-gray-50 pt-4">
                    {empDocs.length === 0 ? (
                      <p className="text-gray-400 text-sm text-center py-4">No documents uploaded yet</p>
                    ) : (
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {empDocs.map(doc => {
                          const docType = documentTypes.find(t => t.value === doc.document_type);
                          return (
                            <div key={doc.id} className="bg-white rounded-lg border p-4 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-sm">{doc.document_name}</p>
                                  <p className="text-xs text-gray-500">{docType?.label || doc.document_type}</p>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[doc.status] || 'bg-gray-100 text-gray-800'}`}>
                                  {(doc.status || 'unknown').replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400">
                                {safeDate(doc.created_date, 'MMM d, yyyy')}
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                <Button size="sm" variant="outline" className="flex-1" onClick={() => setViewerDoc({ url: doc.document_url, title: doc.document_name || 'Document' })}>
                                  <Eye className="w-3 h-3 mr-1" /> View
                                </Button>
                                {doc.document_url && (
                                  <a href={doc.document_url} download target="_blank" rel="noopener noreferrer" className="flex-1">
                                    <Button size="sm" variant="outline" className="w-full">
                                      <Download className="w-3 h-3 mr-1" /> Download
                                    </Button>
                                  </a>
                                )}
                                {doc.status !== 'verified' && (
                                  <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => handleVerifyStatus(doc.id, 'verified')}>
                                    Verify
                                  </Button>
                                )}
                                {doc.status !== 'rejected' && (
                                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => handleVerifyStatus(doc.id, 'rejected')}>
                                    Reject
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {filteredEmployees.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-500">No employees found</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <DocViewerModal
        open={!!viewerDoc}
        url={viewerDoc?.url}
        title={viewerDoc?.title}
        onClose={() => setViewerDoc(null)}
      />

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document for {selectedEmployee?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4 mt-2">
            <div>
              <Label>Document Type *</Label>
              <Select value={formData.document_type} onValueChange={v => setFormData({ ...formData, document_type: v })} required>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {documentTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Document Name *</Label>
              <Input value={formData.document_name} onChange={e => setFormData({ ...formData, document_name: e.target.value })} placeholder="e.g., Aadhar Card - Front" required />
            </div>
            <div>
              <Label>Expiry Date (Optional)</Label>
              <Input type="date" value={formData.expiry_date} onChange={e => setFormData({ ...formData, expiry_date: e.target.value })} />
            </div>
            <div>
              <Label>Select File *</Label>
              <Input type="file" onChange={e => setSelectedFile(e.target.files[0])} accept=".pdf,.jpg,.jpeg,.png" required />
              <p className="text-xs text-gray-500 mt-1">Accepted: PDF, JPG, PNG</p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowUploadDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
