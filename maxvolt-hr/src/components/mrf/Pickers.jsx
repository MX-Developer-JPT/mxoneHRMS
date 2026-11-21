import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check, X, Plus } from 'lucide-react';

export const selectCls = 'w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60';

/** Searchable dropdown. `allowCustom` lets the user keep what they typed when it is not in the list. */
export function SearchSelect({ value, onChange, options, placeholder = 'Select…', allowCustom = false, disabled = false, emptyText = 'Nothing found' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = current?.label || (allowCustom ? value : '') || '';
  const typed = q.trim();
  const canAdd = allowCustom && typed && !options.some((o) => String(o.label).toLowerCase() === typed.toLowerCase());
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 h-9 text-sm hover:bg-accent disabled:opacity-60">
          <span className={shown ? 'truncate' : 'text-muted-foreground'}>{shown || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{canAdd ? ' ' : emptyText}</CommandEmpty>
            <CommandGroup>
              {canAdd && (
                <CommandItem value={`__add__${typed}`} onSelect={() => { onChange(typed); setOpen(false); }}>
                  <Plus className="mr-2 h-4 w-4" /> Use “{typed}”
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.sub || ''}`} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${o.value === value ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.badge && <span className="ml-2 text-[10px] rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">{o.badge}</span>}
                  {o.sub && <span className="ml-2 text-xs text-muted-foreground truncate max-w-[40%]">{o.sub}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Tag input with optional one-click suggestions. Duplicates (any case) are ignored. */
export function TagInput({ value = [], onChange, suggestions = [], placeholder = 'Type and press Enter', disabled = false }) {
  const [text, setText] = useState('');
  const has = (t) => value.some((v) => v.toLowerCase() === t.toLowerCase());
  const add = (t) => { const c = String(t || '').trim(); if (c && !has(c)) onChange([...value, c]); };
  const commit = () => { text.split(',').forEach(add); setText(''); };
  const open = suggestions.filter((s) => !has(s)).slice(0, 14);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-1.5 min-h-9">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-xs px-2 py-1">
            {t}{!disabled && <button type="button" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Remove ${t}`}><X className="w-3 h-3" /></button>}
          </span>
        ))}
        {!disabled && (
          <input className="flex-1 min-w-[140px] bg-transparent text-sm outline-none px-1" value={text} placeholder={placeholder}
            onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }} />
        )}
      </div>
      {open.length > 0 && !disabled && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {open.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 text-primary text-xs px-2 py-0.5 hover:bg-primary/10">
              <Plus className="w-3 h-3" />{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, required, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="text-sm font-medium">{label}{required && <span className="text-red-500"> *</span>}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
