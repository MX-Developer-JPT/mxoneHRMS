import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, X } from 'lucide-react';
import { BRANDS, brandOf } from '@/lib/businessCard';
import { toast } from 'sonner';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 7);
}

export default function CardForm({ card, brand: initialBrand = 'energy', onSaved, onCancel }) {
  const startBrand = card ? brandOf(card) : initialBrand;
  const [form, setForm] = useState({
    name: '', phone_number: '', email: '', job_title: '',
    // Maxvolt Energy cards start blank as before; a ReEarth card starts with ReEarth's company details filled in
    company: !card && startBrand === 'reearth' ? BRANDS.reearth.company : '',
    website: !card && startBrand === 'reearth' ? BRANDS.reearth.website : '',
    address: !card && startBrand === 'reearth' ? BRANDS.reearth.address : '',
    linkedin_url: '', whatsapp_number: '', profile_picture_url: '', brand: startBrand,
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Employee directory, used to pre-fill a NEW card (everything stays editable afterwards).
  const [emps, setEmps] = useState([]);
  const [emailByUser, setEmailByUser] = useState({});
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    if (card) return;
    base44.entities.Employee.list().then(l => setEmps((l || []).filter(e => e.status !== 'inactive' && e.display_name))).catch(() => {});
    base44.entities.User.list().then(us => setEmailByUser(Object.fromEntries((us || []).map(u => [u.id, u.email])))).catch(() => {});
  }, [card]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return emps.filter(e => `${e.display_name} ${e.employee_code || ''} ${e.department || ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, emps]);

  const pickEmployee = (e) => {
    setPicked(e);
    setQuery('');
    setForm(f => ({
      ...f,
      name: e.display_name || '',
      job_title: e.designation || '',
      company: f.company || BRANDS[f.brand || 'energy'].company,
      phone_number: e.phone || e.phone_number || '',
      whatsapp_number: f.whatsapp_number || '',
      email: e.official_email || emailByUser[e.user_id] || '',
      website: f.website || BRANDS[f.brand || 'energy'].website,
      address: f.address || BRANDS[f.brand || 'energy'].address,
    }));
  };

  useEffect(() => {
    if (card) setForm({ ...form, ...card, brand: brandOf(card) });
  }, [card]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const changeBrand = (b) => setForm(f => {
    const from = BRANDS[f.brand || 'energy'], to = BRANDS[b];
    const swap = (cur, a, z) => (!cur || cur === a ? z : cur);   // only replace values that are still the other company's default
    return { ...f, brand: b, company: swap(f.company, from.company, to.company), website: swap(f.website, from.website, to.website), address: swap(f.address, from.address, to.address) };
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast.error('The photo must be under 40 MB'); return; }
    setUploadingPhoto(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm(f => ({ ...f, profile_picture_url: file_url, _remove_photo: false }));
      // Save the new photo on the card right away when editing, so it is kept even if the form is closed
      if (card?.id) { await base44.entities.DigitalBusinessCard.update(card.id, { profile_picture_url: file_url }); toast.success('Photo saved'); }
    } catch (err) { toast.error(err.message || 'Could not upload the photo — please try again'); }
    setUploadingPhoto(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const data = { ...form };
    if (!card) delete data._remove_photo;
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
      <div>
        <Label className="text-xs text-gray-600 mb-1 block">Card for</Label>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(BRANDS).map(b => (
            <button key={b.key} type="button" onClick={() => changeBrand(b.key)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${(form.brand || 'energy') === b.key ? (b.key === 'reearth' ? 'bg-[#26357f] text-white border-transparent' : 'bg-neutral-900 text-amber-400 border-transparent') : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{b.label}</button>
          ))}
        </div>
      </div>
      {!card && (
        <div className="relative rounded-lg border bg-blue-50/50 p-3">
          <Label className="text-xs text-gray-600 mb-1 block">Find an employee to pre-fill the details</Label>
          <Input className="h-9 bg-white" placeholder="Search by name, code or department…" value={query} onChange={e => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <div className="absolute left-3 right-3 z-20 mt-1 rounded-md border bg-white shadow-md max-h-60 overflow-y-auto divide-y">
              {matches.map(e => (
                <button key={e.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => pickEmployee(e)}>
                  <span className="font-medium">{e.display_name}</span> <span className="text-xs text-gray-500">{e.employee_code} · {e.designation || '—'}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-1.5">{picked ? `Pre-filled from ${picked.display_name}'s directory entry — you can still edit any field below.` : 'Details come from the employee directory; you can edit name, designation, phone and email afterwards.'}</p>
        </div>
      )}

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
            <button type="button" title="Remove the photo from this card" onClick={() => setForm(f => ({ ...f, profile_picture_url: '', _remove_photo: true }))} className="text-gray-400 hover:text-red-500">
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