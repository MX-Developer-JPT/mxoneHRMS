import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';

export const specValue = (form, f) => (f.core ? form?.[f.key] : form?.specs?.[f.key]) ?? '';
export const setSpec = (form, f, v) => (f.core ? { ...form, [f.key]: v } : { ...form, specs: { ...(form.specs || {}), [f.key]: v } });

/** The category-specific specification inputs of the Add / Edit Asset form, drawn from the type's field schema. */
export function AssetSpecFields({ schema, form, setForm }) {
  if (!schema?.fields?.length) return null;
  return (
    <div className="col-span-2 border rounded-lg p-3 bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{schema.category_label} specifications</p>
      <div className="grid grid-cols-2 gap-3">
        {schema.fields.map((f) => {
          const v = specValue(form, f);
          const wide = f.type === 'textarea';
          return (
            <div key={f.key} className={wide ? 'col-span-2' : ''}>
              <Label className="text-xs">{f.label}{f.required ? ' *' : ''}</Label>
              {f.type === 'select' ? (
                <Select value={String(v || '')} onValueChange={(x) => setForm(setSpec(form, f, x))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{(f.options || []).map((o) => <SelectItem key={o} value={o}>{f.key === 'condition' ? o.toUpperCase() : o}</SelectItem>)}</SelectContent>
                </Select>
              ) : f.type === 'textarea' ? (
                <textarea className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} value={v} onChange={(e) => setForm(setSpec(form, f, e.target.value))} />
              ) : (
                <Input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} inputMode={f.type === 'imei' ? 'numeric' : undefined} value={v}
                  placeholder={f.placeholder || ''} onChange={(e) => setForm(setSpec(form, f, e.target.value))} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Lets HR add their own specification fields to an asset type — no code change needed. */
export function CustomFieldsEditor({ fields, onChange }) {
  const list = fields || [];
  const upd = (i, patch) => onChange(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-xs text-muted-foreground">No custom fields. Add one for anything the standard fields do not cover (e.g. “Insurance policy no.”).</p>}
      {list.map((f, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-2 bg-muted/20">
          <div className="flex gap-2">
            <Input className="flex-1" placeholder="Field name" value={f.label || ''} onChange={(e) => upd(i, { label: e.target.value })} />
            <Select value={f.type || 'text'} onValueChange={(x) => upd(i, { type: x })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{[['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Choice list']].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove field"><Trash2 className="w-4 h-4" /></Button>
          </div>
          {f.type === 'select' && <Input placeholder="Choices, separated by commas (e.g. A, B, C)" value={Array.isArray(f.options) ? f.options.join(', ') : (f.options || '')} onChange={(e) => upd(i, { options: e.target.value })} />}
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!f.required} onChange={(e) => upd(i, { required: e.target.checked })} />Required</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!f.unique} onChange={(e) => upd(i, { unique: e.target.checked })} />Must be unique across assets</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={f.show !== false} onChange={(e) => upd(i, { show: e.target.checked })} />Print on the letter</label>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, { label: '', type: 'text', required: false, show: true }])}><Plus className="w-3.5 h-3.5 mr-1" /> Add custom field</Button>
    </div>
  );
}
