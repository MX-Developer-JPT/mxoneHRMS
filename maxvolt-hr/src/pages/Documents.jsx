import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileText, Upload, Eye, Plus } from 'lucide-react';
import DocViewerModal from '@/components/DocViewerModal';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function Documents() {
  const [user, setUser] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [formData, setFormData] = useState({
    document_type: '',
    document_name: '',
    expiry_date: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const docs = await base44.entities.Document.filter(
        { user_id: currentUser.id },
        '-created_date'
      );
      setDocuments(docs);
      setLoading(false);
    } catch (error) {
      console.error('Error loading documents:', error);
      setLoading(false);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    try {
      setUploading(true);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: selectedFile });

      await base44.entities.Document.create({
        ...formData,
        user_id: user.id,
        document_url: file_url,
        uploaded_by: user.id,
        status: 'pending_verification'
      });

      toast.success('Document uploaded successfully');
      setShowUpload(false);
      setFormData({ document_type: '', document_name: '', expiry_date: '' });
      setSelectedFile(null);
      loadData();
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const statusColors = {
    pending_verification: 'bg-yellow-100 text-yellow-800',
    verified: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-800'
  };

  const documentTypes = [
    { value: 'aadhar', label: 'Aadhar Card' },
    { value: 'pan', label: 'PAN Card' },
    { value: 'passport', label: 'Passport' },
    { value: 'driving_license', label: 'Driving License' },
    { value: 'educational', label: 'Educational Certificate' },
    { value: 'experience_letter', label: 'Experience Letter' },
    { value: 'offer_letter', label: 'Offer Letter' },
    { value: 'contract', label: 'Employment Contract' },
    { value: 'other', label: 'Other' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">My Documents</h1>
            <p className="text-gray-600 mt-1">Manage your personal documents</p>
          </div>
          <Dialog open={showUpload} onOpenChange={setShowUpload}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-5 h-5 mr-2" />
                Upload Document
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload New Document</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <Label>Document Type</Label>
                  <Select
                    value={formData.document_type}
                    onValueChange={(value) => setFormData({ ...formData, document_type: value })}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {documentTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Document Name</Label>
                  <Input
                    value={formData.document_name}
                    onChange={(e) => setFormData({ ...formData, document_name: e.target.value })}
                    placeholder="e.g., Aadhar Card - Front"
                    required
                  />
                </div>

                <div>
                  <Label>Expiry Date (Optional)</Label>
                  <Input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Select File</Label>
                  <Input
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files[0])}
                    accept=".pdf,.jpg,.jpeg,.png"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Accepted: PDF, JPG, PNG (Max 10MB)</p>
                </div>

                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowUpload(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={uploading}>
                    {uploading ? 'Uploading...' : 'Upload'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {documents.map(doc => {
            const docType = documentTypes.find(t => t.value === doc.document_type);
            return (
              <Card key={doc.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-3 bg-blue-100 rounded-full">
                      <FileText className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-sm">{docType?.label}</CardTitle>
                      <Badge className={statusColors[doc.status] || 'bg-gray-100 text-gray-800'}>
                        {(doc.status || 'unknown').replace('_', ' ').toUpperCase()}
                      </Badge>
                      {doc.notes && doc.status === 'rejected' && (
                        <p className="text-xs text-red-600 mt-1">Note: {doc.notes}</p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="font-medium">{doc.document_name}</p>
                  
                  <div className="text-xs text-gray-600 space-y-1">
                    <p>Uploaded: {safeDate(doc.created_date, 'MMM d, yyyy')}</p>
                    {doc.expiry_date && (
                      <p>Expires: {safeDate(doc.expiry_date, 'MMM d, yyyy')}</p>
                    )}
                  </div>

                  <Button
                    onClick={() => setViewerDoc({
                      url: doc.document_url || null,
                      title: doc.document_name || 'Document',
                      content: doc.letter_content || doc.html_content || doc.content || null,
                      isHtml: !!(doc.html_content || (doc.letter_content && doc.letter_content.trim().startsWith('<'))),
                    })}
                    className="w-full"
                    variant="outline"
                    size="sm"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    View Document
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <DocViewerModal
          open={!!viewerDoc}
          url={viewerDoc?.url}
          title={viewerDoc?.title}
          content={viewerDoc?.content}
          isHtml={viewerDoc?.isHtml}
          onClose={() => setViewerDoc(null)}
        />

        {documents.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <Upload className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No documents uploaded yet</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}