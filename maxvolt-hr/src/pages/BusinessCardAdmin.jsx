import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Search, Edit2, Trash2, QrCode, Upload, ExternalLink, Printer, Link2, Phone, Mail, Loader2 } from 'lucide-react';
import CardForm from '@/components/businesscard/CardForm';
import QRCodeModal from '@/components/businesscard/QRCodeModal';
import BulkImportModal from '@/components/businesscard/BulkImportModal';
import { cardUrl as getCardUrl, initials } from '@/lib/businessCard';
import { TAGLINE } from '@/lib/brand';

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(false));
    loadCards();
  }, []);

  const loadCards = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.DigitalBusinessCard.list('-created_date', 500);
      setCards(data);
    } catch (e) {
      toast.error('Could not load business cards');
    }
    setLoading(false);
  };

  const handleDelete = async (card) => {
    try {
      await base44.entities.DigitalBusinessCard.delete(card.id);
      toast.success('Card deleted');
    } catch (e) {
      toast.error(e.message || 'Could not delete card');
    }
    setDeleteConfirm(null);
    loadCards();
  };

  const handleSaved = () => { setShowForm(false); setEditingCard(null); loadCards(); };
  const handleEdit = (card) => { setEditingCard(card); setShowForm(true); };

  const copyLink = async (card) => {
    try { await navigator.clipboard.writeText(getCardUrl(card)); toast.success('Card link copied'); }
    catch { toast.error('Could not copy the link'); }
  };

  const q = search.trim().toLowerCase();
  const filtered = cards.filter(c =>
    !q || [c.name, c.company, c.job_title, c.email, c.phone_number].some(v => String(v || '').toLowerCase().includes(q))
  );

  const handlePrintCards = async () => {
    // Opened synchronously (inside the click) so the browser doesn't treat the
    // later write as a blocked popup; filled once the QR codes are ready.
    const win = window.open('', '_blank');
    if (!win) { toast.error('Allow pop-ups to print the cards'); return; }
    setPrinting(true);
    try {
      const items = await Promise.all(filtered.map(async c => ({
        c, qr: await QRCode.toDataURL(getCardUrl(c), { width: 260, margin: 1, color: { dark: '#111111', light: '#ffffff' } }),
      })));
      const cardsHtml = items.map(({ c, qr }) => `
        <div class="card">
          <div class="stripe"></div>
          <div class="left">
            <div class="brand">MAXVOLT ENERGY</div>
            <div class="name">${escHtml(c.name)}</div>
            <div class="title">${escHtml(c.job_title)}</div>
            <div class="rows">
              ${c.phone_number ? `<div>☎ ${escHtml(c.phone_number)}</div>` : ''}
              ${c.email ? `<div>✉ ${escHtml(c.email)}</div>` : ''}
              ${c.website ? `<div>⌁ ${escHtml(String(c.website).replace(/^https?:\/\//i, ''))}</div>` : ''}
            </div>
          </div>
          <div class="right"><img src="${qr}" /><span>Scan to save</span></div>
        </div>`).join('');
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Business Cards</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .grid { display: grid; grid-template-columns: repeat(2, 90mm); gap: 6mm 8mm; justify-content: center; }
          .card { position: relative; width: 90mm; height: 55mm; border-radius: 3mm; background: #111; color: #fff; overflow: hidden; display: flex; page-break-inside: avoid; }
          .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 3mm; background: linear-gradient(90deg,#fcd116,#f5b800); }
          .left { flex: 1; padding: 6mm 4mm 7mm 6mm; display: flex; flex-direction: column; }
          .brand { font-size: 6.5pt; letter-spacing: .2em; color: #fcd116; font-weight: 700; }
          .name { font-size: 13pt; font-weight: 700; margin-top: 4mm; line-height: 1.15; }
          .title { font-size: 8pt; color: #fcd116; margin-top: 1mm; }
          .rows { margin-top: auto; font-size: 7pt; line-height: 1.55; color: #e5e5e5; word-break: break-all; }
          .right { width: 26mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5mm; padding-right: 4mm; }
          .right img { width: 22mm; height: 22mm; background: #fff; padding: 1mm; border-radius: 1.5mm; }
          .right span { font-size: 5.5pt; color: #bbb; }
        </style></head><body><div class="grid">${cardsHtml}</div></body></html>`);
      win.document.close();
      setTimeout(() => { try { win.print(); } catch { /* user closed it */ } }, 800);
    } catch (e) {
      win.close();
      toast.error('Could not generate the print sheet');
    }
    setPrinting(false);
  };

  if (user === null) {
    return <div className="flex items-center justify-center h-screen"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  }
  if (user === false || user.role !== 'admin') {
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Digital Business Cards</h1>
          <p className="text-gray-500 text-sm mt-1">{cards.length} card{cards.length !== 1 ? 's' : ''} · each has its own shareable link and QR code</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handlePrintCards} disabled={filtered.length === 0 || printing}>
            {printing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
            {printing ? 'Preparing…' : 'Print Cards'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBulkImport(true)}>
            <Upload className="w-4 h-4 mr-2" /> Bulk Import
          </Button>
          <Button size="sm" onClick={() => { setEditingCard(null); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Add Card
          </Button>
        </div>
      </div>

      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="Search by name, company, title, email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <QrCode className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{search ? 'No cards match your search.' : 'No cards yet. Add your first one!'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(card => (
            <div key={card.id} className="rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-sm hover:shadow-lg transition-shadow flex flex-col">
              {/* mini card preview, same look as the public card */}
              <div className="relative bg-neutral-900 text-white p-4 pb-5">
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />
                <div className="text-[9px] font-bold tracking-[0.2em] text-amber-300 mb-3">MAXVOLT ENERGY</div>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-neutral-800 border-2 border-amber-400 flex items-center justify-center overflow-hidden shrink-0">
                    {card.profile_picture_url
                      ? <img src={card.profile_picture_url} alt="" className="w-full h-full object-cover" />
                      : <span className="font-bold text-amber-400">{initials(card.name)}</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{card.name}</p>
                    <p className="text-xs text-amber-300 truncate">{card.job_title}</p>
                    <p className="text-[11px] text-white/60 truncate">{card.company}</p>
                  </div>
                </div>
              </div>
              <div className="p-3 space-y-1 text-xs text-gray-500 flex-1">
                {card.phone_number && <p className="flex items-center gap-1.5 truncate"><Phone className="w-3 h-3 shrink-0" />{card.phone_number}</p>}
                {card.email && <p className="flex items-center gap-1.5 truncate"><Mail className="w-3 h-3 shrink-0" />{card.email}</p>}
              </div>
              <div className="px-3 pb-3 flex items-center gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-8 text-xs px-2.5" onClick={() => setQrCard(card)}><QrCode className="w-3 h-3 mr-1" /> QR</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2.5" onClick={() => copyLink(card)}><Link2 className="w-3 h-3 mr-1" /> Copy link</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2.5" asChild>
                  <a href={getCardUrl(card)} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 mr-1" /> View</a>
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2.5" onClick={() => handleEdit(card)}><Edit2 className="w-3 h-3 mr-1" /> Edit</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteConfirm(card)} aria-label="Delete card"><Trash2 className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 mt-8">{TAGLINE}</p>

      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingCard(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingCard ? 'Edit Card' : 'Add New Card'}</DialogTitle></DialogHeader>
          <CardForm card={editingCard} onSaved={handleSaved} onCancel={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      {qrCard && <QRCodeModal card={qrCard} onClose={() => setQrCard(null)} getCardUrl={getCardUrl} />}
      {showBulkImport && <BulkImportModal onClose={() => setShowBulkImport(false)} onImported={() => { setShowBulkImport(false); loadCards(); }} />}

      <Dialog open={!!deleteConfirm} onOpenChange={v => !v && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Card</DialogTitle></DialogHeader>
          <p className="text-gray-600 text-sm">Delete <strong>{deleteConfirm?.name}</strong>'s card? Its link and QR code will stop working. This cannot be undone.</p>
          <div className="flex gap-2 mt-4 justify-end">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
