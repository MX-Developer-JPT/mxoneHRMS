import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Search, Edit2, Trash2, QrCode, Download, Upload, ExternalLink, User, Printer } from 'lucide-react';
import CardForm from '@/components/businesscard/CardForm';
import QRCodeModal from '@/components/businesscard/QRCodeModal';
import BulkImportModal from '@/components/businesscard/BulkImportModal';

export default function BusinessCardAdmin() {
  const [user, setUser] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [qrCard, setQrCard] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    loadUser();
    loadCards();
  }, []);

  const loadUser = async () => {
    const u = await base44.auth.me();
    setUser(u);
  };

  const loadCards = async () => {
    setLoading(true);
    const data = await base44.entities.DigitalBusinessCard.list('-created_date', 200);
    setCards(data);
    setLoading(false);
  };

  const handleDelete = async (card) => {
    await base44.entities.DigitalBusinessCard.delete(card.id);
    setDeleteConfirm(null);
    loadCards();
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditingCard(null);
    loadCards();
  };

  const handleEdit = (card) => {
    setEditingCard(card);
    setShowForm(true);
  };

  const getCardUrl = (card) => {
    return `https://maxone.maxvoltenergy.com/PublicBusinessCard?slug=${card.unique_slug}`;
  };

  const filtered = cards.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase()) ||
    c.job_title?.toLowerCase().includes(search.toLowerCase())
  );

  const isAdmin = user?.role === 'admin';
  const [printing, setPrinting] = useState(false);

  const handlePrintCards = () => {
    setPrinting(true);
    const cardsHtml = filtered.map(c => `
      <div class="card">
        <div class="card-name">${c.name || ''}</div>
        <div class="card-title">${c.job_title || ''}</div>
        <div class="card-company">${c.company || ''}</div>
        ${c.phone_number ? `<div class="card-detail">📞 ${c.phone_number}</div>` : ''}
        ${c.email ? `<div class="card-detail">✉ ${c.email}</div>` : ''}
        ${c.website ? `<div class="card-detail">🌐 ${c.website}</div>` : ''}
      </div>
    `).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Business Cards</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 16px; background: #fff; }
        .grid { display: flex; flex-wrap: wrap; gap: 12px; }
        .card { border: 1px solid #333; border-radius: 8px; padding: 14px 16px; width: 240px; background: linear-gradient(135deg,#1e3a5f,#2d5a8e); color:#fff; page-break-inside: avoid; }
        .card-name { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
        .card-title { font-size: 11px; opacity: 0.8; margin-bottom: 6px; }
        .card-company { font-size: 12px; font-weight: 600; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 6px; }
        .card-detail { font-size: 10px; opacity: 0.85; margin-top: 3px; }
        @media print { @page { margin: 10mm; } }
      </style></head>
      <body><div class="grid">${cardsHtml}</div></body></html>`);
    win.document.close();
    win.onload = () => { win.print(); setPrinting(false); };
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <QrCode className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Digital Business Cards</h1>
          <p className="text-gray-500 text-sm mt-1">{cards.length} card{cards.length !== 1 ? 's' : ''} total</p>
        </div>
        <div className="flex gap-2">
           <Button 
             variant="outline" 
             size="sm" 
             onClick={handlePrintCards}
             disabled={filtered.length === 0 || printing}
           >
             <Printer className="w-4 h-4 mr-2" />
             {printing ? 'Generating...' : 'Print Cards'}
           </Button>
           <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)}>
             <Upload className="w-4 h-4 mr-2" />
             Bulk Import
           </Button>
           <Button size="sm" onClick={() => { setEditingCard(null); setShowForm(true); }}>
             <Plus className="w-4 h-4 mr-2" />
             Add Card
           </Button>
         </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search by name, company or title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <QrCode className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{search ? 'No cards match your search.' : 'No cards yet. Add your first one!'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(card => (
            <Card key={card.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {card.profile_picture_url
                      ? <img src={card.profile_picture_url} alt="" className="w-full h-full object-cover" />
                      : <User className="w-5 h-5 text-blue-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{card.name}</p>
                    <p className="text-sm text-blue-600 truncate">{card.job_title}</p>
                    <p className="text-xs text-gray-500 truncate">{card.company}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setQrCard(card)}>
                    <QrCode className="w-3 h-3 mr-1" /> QR Code
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" asChild>
                    <a href={getCardUrl(card)} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-3 h-3 mr-1" /> View
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => handleEdit(card)}>
                    <Edit2 className="w-3 h-3 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteConfirm(card)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingCard(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCard ? 'Edit Card' : 'Add New Card'}</DialogTitle>
          </DialogHeader>
          <CardForm card={editingCard} onSaved={handleSaved} onCancel={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      {/* QR Code Modal */}
      {qrCard && <QRCodeModal card={qrCard} onClose={() => setQrCard(null)} getCardUrl={getCardUrl} />}

      {/* Bulk Import Modal */}
      {showBulkImport && <BulkImportModal onClose={() => setShowBulkImport(false)} onImported={() => { setShowBulkImport(false); loadCards(); }} />}

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={v => !v && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Card</DialogTitle>
          </DialogHeader>
          <p className="text-gray-600 text-sm">Are you sure you want to delete <strong>{deleteConfirm?.name}</strong>'s card? This cannot be undone.</p>
          <div className="flex gap-2 mt-4 justify-end">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}