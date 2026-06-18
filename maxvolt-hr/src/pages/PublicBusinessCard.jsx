import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Phone, Mail, Globe, MapPin, Linkedin, MessageCircle, Download, Building2, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PublicBusinessCard() {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');

  useEffect(() => {
    if (slug) loadCard(slug);
    else setNotFound(true);
  }, [slug]);

  const loadCard = async (slug) => {
    try {
      const response = await base44.functions.invoke('getBusinessCard', { slug });
      if (response.data?.card) {
        setCard(response.data.card);
      } else {
        setNotFound(true);
      }
    } catch (e) {
      console.error('Error loading card:', e);
      setNotFound(true);
    }
    setLoading(false);
  };

  const handleSaveContact = () => {
    if (!card) return;
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${card.name}`,
      card.job_title ? `TITLE:${card.job_title}` : '',
      card.company ? `ORG:${card.company}` : '',
      card.phone_number ? `TEL;TYPE=CELL:${card.phone_number}` : '',
      card.email ? `EMAIL:${card.email}` : '',
      card.website ? `URL:${card.website}` : '',
      card.address ? `ADR:;;${card.address}` : '',
      'END:VCARD',
    ].filter(Boolean).join('\n');

    const blob = new Blob([lines], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.name.replace(/\s+/g, '_')}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const whatsappNumber = (card?.whatsapp_number || card?.phone_number || '').replace(/[^0-9]/g, '');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-blue-900">
        <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !card) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-blue-900 text-white text-center px-4">
        <div>
          <p className="text-5xl mb-4">🃏</p>
          <h1 className="text-xl font-semibold mb-2">Card Not Found</h1>
          <p className="text-white/60 text-sm">This business card doesn't exist or has been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Card */}
         <div className="bg-white rounded-3xl overflow-hidden shadow-2xl">
          {/* Avatar */}
          <div className="flex justify-center pt-6 mb-4">
            <div className="w-24 h-24 rounded-full border-4 border-white shadow-lg bg-blue-100 flex items-center justify-center overflow-hidden">
              {card.profile_picture_url
                ? <img src={card.profile_picture_url} alt={card.name} className="w-full h-full object-cover" />
                : <span className="text-3xl font-bold text-blue-600">{card.name?.charAt(0)?.toUpperCase()}</span>
              }
            </div>
          </div>

          {/* Name & Title */}
          <div className="text-center px-6 pb-4">
            <h1 className="text-2xl font-bold text-gray-900">{card.name}</h1>
            {card.job_title && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-blue-600 font-medium text-sm">{card.job_title}</p>
              </div>
            )}
            {card.company && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
                <p className="text-gray-500 text-sm">{card.company}</p>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-6 border-t border-gray-100" />

          {/* Quick Action Buttons */}
          <div className="px-6 pt-4 grid grid-cols-4 gap-2">
            {card.phone_number && (
              <a href={`tel:${card.phone_number}`} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors">
                  <Phone className="w-5 h-5 text-green-600" />
                </div>
                <span className="text-xs text-gray-500">Call</span>
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center hover:bg-blue-200 transition-colors">
                  <Mail className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-xs text-gray-500">Email</span>
              </a>
            )}
            {whatsappNumber && (
              <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center hover:bg-green-200 transition-colors">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                </div>
                <span className="text-xs text-gray-500">WhatsApp</span>
              </a>
            )}
            {card.linkedin_url && (
              <a href={card.linkedin_url} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center hover:bg-blue-200 transition-colors">
                  <Linkedin className="w-5 h-5 text-blue-700" />
                </div>
                <span className="text-xs text-gray-500">LinkedIn</span>
              </a>
            )}
          </div>

          {/* Contact Details */}
          <div className="px-6 py-4 space-y-3">
            {card.phone_number && (
              <a href={`tel:${card.phone_number}`} className="flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-full bg-green-50 flex items-center justify-center group-hover:bg-green-100 transition-colors flex-shrink-0">
                  <Phone className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p className="text-sm font-medium text-gray-800">{card.phone_number}</p>
                </div>
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} className="flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors flex-shrink-0">
                  <Mail className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-sm font-medium text-gray-800 break-all">{card.email}</p>
                </div>
              </a>
            )}
            {card.website && (
              <a href={card.website.startsWith('http') ? card.website : `https://${card.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-full bg-purple-50 flex items-center justify-center group-hover:bg-purple-100 transition-colors flex-shrink-0">
                  <Globe className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Website</p>
                  <p className="text-sm font-medium text-gray-800 truncate">{card.website}</p>
                </div>
              </a>
            )}
            {card.address && (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-orange-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Address</p>
                  <p className="text-sm font-medium text-gray-800">{card.address}</p>
                </div>
              </div>
            )}
          </div>

          {/* Save Contact CTA */}
          <div className="px-6 pb-6">
            <Button onClick={handleSaveContact} className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 h-12 text-base rounded-xl">
              <Download className="w-5 h-5" /> Save Contact
            </Button>
          </div>
        </div>


      </div>
    </div>
  );
}