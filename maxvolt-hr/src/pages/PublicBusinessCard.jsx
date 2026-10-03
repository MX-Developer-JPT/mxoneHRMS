import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Phone, Mail, Globe, MapPin, Linkedin, MessageCircle, UserPlus, QrCode, Navigation } from 'lucide-react';
import { TAGLINE } from '@/lib/brand';
import { downloadVCard, initials, webHref, digits } from '@/lib/businessCard';

const Shell = ({ children }) => (
  <div className="min-h-screen bg-neutral-950 relative overflow-hidden flex items-start sm:items-center justify-center px-4 py-8">
    {/* brand glow */}
    <div className="pointer-events-none absolute -top-40 -right-32 w-[28rem] h-[28rem] rounded-full bg-amber-400/20 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-48 -left-32 w-[26rem] h-[26rem] rounded-full bg-amber-500/10 blur-3xl" />
    <div className="relative w-full max-w-sm">{children}</div>
  </div>
);

function Action({ href, onClick, icon: Icon, label, tone, external }) {
  const cls = 'flex flex-col items-center gap-1.5 group';
  const inner = (
    <>
      <span className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group-hover:-translate-y-0.5 group-active:scale-95 ${tone}`}>
        <Icon className="w-5 h-5" />
      </span>
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
    </>
  );
  return href
    ? <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className={cls}>{inner}</a>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function Row({ href, icon: Icon, label, value, external, tone }) {
  const body = (
    <>
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-4 h-4" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-neutral-400">{label}</span>
        <span className="block text-sm font-medium text-neutral-900 break-words">{value}</span>
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 py-2 rounded-xl hover:bg-neutral-50 -mx-2 px-2 transition-colors';
  return href
    ? <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} className={cls}>{body}</a>
    : <div className={cls}>{body}</div>;
}

export default function PublicBusinessCard() {
  const [card, setCard] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | notfound | error
  const slug = new URLSearchParams(window.location.search).get('slug');

  useEffect(() => {
    if (!slug) { setState('notfound'); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await base44.functions.invoke('getBusinessCard', { slug });
        const c = res?.data?.card;
        if (cancelled) return;
        if (c) { setCard(c); setState('ready'); document.title = `${c.name} — ${c.company || 'Maxvolt Energy'}`; }
        else setState('notfound');
      } catch (e) {
        console.error('Error loading card:', e);
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="bg-white rounded-3xl overflow-hidden shadow-2xl animate-pulse">
          <div className="h-32 bg-neutral-900" />
          <div className="px-6 pb-8 -mt-12 flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-full bg-neutral-200 border-4 border-white" />
            <div className="h-5 w-40 bg-neutral-200 rounded" />
            <div className="h-4 w-28 bg-neutral-100 rounded" />
            <div className="h-12 w-full bg-neutral-100 rounded-xl mt-4" />
          </div>
        </div>
      </Shell>
    );
  }

  if (state !== 'ready') {
    return (
      <Shell>
        <div className="bg-white rounded-3xl shadow-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-900 text-amber-400 flex items-center justify-center mx-auto mb-4"><QrCode className="w-7 h-7" /></div>
          <h1 className="text-lg font-bold text-neutral-900">{state === 'error' ? "Couldn't load this card" : 'Card not found'}</h1>
          <p className="text-sm text-neutral-500 mt-1.5">
            {state === 'error' ? 'Please check your connection and try again.' : "This business card doesn't exist or has been removed."}
          </p>
          {state === 'error' && <button onClick={() => window.location.reload()} className="mt-5 px-5 py-2.5 rounded-xl bg-neutral-900 text-amber-400 text-sm font-semibold">Retry</button>}
          <p className="text-[11px] text-neutral-400 mt-6">{TAGLINE}</p>
        </div>
      </Shell>
    );
  }

  const wa = digits(card.whatsapp_number || card.phone_number);
  const mapHref = card.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}` : null;

  return (
    <Shell>
      <div className="bg-white rounded-3xl overflow-hidden shadow-2xl">
        {/* Hero */}
        <div className="relative h-36 bg-neutral-900 overflow-hidden">
          <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />
          <div className="absolute -top-10 right-[-30px] w-48 h-48 rotate-12 bg-amber-400/90 [clip-path:polygon(30%_0,100%_0,100%_100%,0_100%)] opacity-90" />
          <div className="absolute top-4 left-5 text-[10px] font-bold tracking-[0.2em] uppercase text-amber-300">Maxvolt Energy</div>
          <div className="absolute top-8 left-5 text-white/70 text-[11px] leading-tight max-w-[10rem]">Cleaner energy.<br />Brighter tomorrow.</div>
        </div>

        {/* Avatar */}
        <div className="flex justify-center -mt-14 relative">
          <div className="w-28 h-28 rounded-full border-4 border-white shadow-xl bg-gradient-to-br from-neutral-800 to-neutral-950 flex items-center justify-center overflow-hidden">
            {card.profile_picture_url
              ? <img src={card.profile_picture_url} alt={card.name} className="w-full h-full object-cover" />
              : <span className="text-3xl font-bold text-amber-400">{initials(card.name)}</span>}
          </div>
        </div>

        {/* Identity */}
        <div className="text-center px-6 pt-3 pb-4">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">{card.name}</h1>
          {card.job_title && <p className="text-sm font-semibold text-amber-600 mt-0.5">{card.job_title}</p>}
          {card.company && <p className="text-sm text-neutral-500 mt-0.5">{card.company}</p>}
        </div>

        {/* Quick actions */}
        <div className="px-5 pb-4 grid gap-2 grid-cols-4">
          {card.phone_number && <Action href={`tel:${card.phone_number}`} icon={Phone} label="Call" tone="bg-neutral-900 text-amber-400" />}
          {wa && <Action href={`https://wa.me/${wa}`} external icon={MessageCircle} label="WhatsApp" tone="bg-green-100 text-green-600" />}
          {card.email && <Action href={`mailto:${card.email}`} icon={Mail} label="Email" tone="bg-amber-100 text-amber-700" />}
          {card.linkedin_url && <Action href={webHref(card.linkedin_url)} external icon={Linkedin} label="LinkedIn" tone="bg-sky-100 text-sky-700" />}
          {card.website && <Action href={webHref(card.website)} external icon={Globe} label="Website" tone="bg-violet-100 text-violet-600" />}
          {mapHref && <Action href={mapHref} external icon={Navigation} label="Directions" tone="bg-rose-100 text-rose-600" />}
        </div>

        <div className="mx-6 border-t border-neutral-100" />

        {/* Details */}
        <div className="px-6 py-3">
          {card.phone_number && <Row href={`tel:${card.phone_number}`} icon={Phone} label="Phone" value={card.phone_number} tone="bg-neutral-900 text-amber-400" />}
          {card.email && <Row href={`mailto:${card.email}`} icon={Mail} label="Email" value={card.email} tone="bg-amber-100 text-amber-700" />}
          {card.website && <Row href={webHref(card.website)} external icon={Globe} label="Website" value={card.website.replace(/^https?:\/\//i, '')} tone="bg-violet-100 text-violet-600" />}
          {card.address && <Row href={mapHref} external icon={MapPin} label="Address" value={card.address} tone="bg-rose-100 text-rose-600" />}
        </div>

        {/* CTA */}
        <div className="px-6 pb-5 space-y-2.5">
          <button onClick={() => downloadVCard(card)} className="w-full h-12 rounded-2xl bg-neutral-900 text-amber-400 font-semibold text-base flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.99] transition-all shadow-lg shadow-neutral-900/20">
            <UserPlus className="w-5 h-5" /> Save to Contacts
          </button>
        </div>

        {/* Footer */}
        <div className="bg-neutral-50 border-t border-neutral-100 px-6 py-3 text-center">
          <p className="text-[11px] font-semibold text-neutral-500 tracking-wide">{TAGLINE}</p>
          <p className="text-[10px] text-neutral-400 mt-0.5">Digital card · Maxvolt One</p>
        </div>
      </div>
    </Shell>
  );
}
