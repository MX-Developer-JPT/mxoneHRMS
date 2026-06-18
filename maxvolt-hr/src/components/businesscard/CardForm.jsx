import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, X } from 'lucide-react';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 7);
}

export default function CardForm({ card, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: '', phone_number: '', email: '', company: '', job_title: '',
    website: '', address: '', linkedin_url: '', whatsapp_number: '', profile_picture_url: ''
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (card) setForm({ ...form, ...card });
  }, [card]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set('profile_picture_url', file_url);
    setUploadingPhoto(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = { ...form };
    if (!card) {
      data.unique_slug = generateSlug(form.name || 'card');
    }
    if (card) {
      await base44.entities.DigitalBusinessCard.update(card.id, data);
    } else {
      await base44.entities.DigitalBusinessCard.create(data);
    }
    setSaving(false);
    onSaved();
  };

  const fields = [
    { key: 'name', label: 'Full Name *', placeholder: 'John Doe', required: true },
    { key: 'job_title', label: 'Job Title *', placeholder: 'Software Engineer', required: true },
    { key: 'company', label: 'Company *', placeholder: 'Acme Corp', required: true },
    { key: 'phone_number', label: 'Phone *', placeholder: '+91 98765 43210', required: true },
    { key: 'email', label: 'Email *', placeholder: 'john@acme.com', required: true },
    { key: 'whatsapp_number', label: 'WhatsApp Number', placeholder: '+91 98765 43210' },
    { key: 'website', label: 'Website', placeholder: 'https://acme.com' },
    { key: 'linkedin_url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/johndoe' },
    { key: 'address', label: 'Address', placeholder: '123 Main St, Mumbai' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Profile Picture Upload */}
      <div>
        <Label className="text-xs text-gray-600 mb-1 block">Profile Picture</Label>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden flex-shrink-0">
            {form.profile_picture_url
              ? <img src={form.profile_picture_url} alt="Preview" className="w-full h-full object-cover" />
              : <Upload className="w-5 h-5 text-gray-400" />
            }
          </div>
          <div className="flex-1">
            <label className="cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm text-gray-600">
                {uploadingPhoto ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingPhoto ? 'Uploading...' : 'Upload Photo'}
              </div>
            </label>
          </div>
          {form.profile_picture_url && (
            <button type="button" onClick={() => set('profile_picture_url', '')} className="text-gray-400 hover:text-red-500">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {fields.map(f => (
        <div key={f.key}>
          <Label className="text-xs text-gray-600 mb-1 block">{f.label}</Label>
          <Input
            value={form[f.key] || ''}
            onChange={e => set(f.key, e.target.value)}
            placeholder={f.placeholder}
            required={f.required}
            className="h-9"
          />
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={saving} className="flex-1">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {card ? 'Save Changes' : 'Create Card'}
        </Button>
      </div>
    </form>
  );
}