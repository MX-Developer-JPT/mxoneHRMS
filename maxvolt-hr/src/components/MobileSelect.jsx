import { useState, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

/**
 * MobileSelect – uses a bottom-sheet Drawer on mobile (<768px) for ergonomic selection,
 * falls back to the standard shadcn Select on desktop.
 *
 * Props:
 *   value          – current selected value
 *   onValueChange  – callback(value)
 *   placeholder    – placeholder text
 *   label          – title shown inside the Drawer header
 *   options        – [{ value: string, label: string }]
 *   className      – optional extra class on the trigger button
 *   disabled       – boolean
 */
export default function MobileSelect({ value, onValueChange, placeholder, label, options = [], className = '', disabled = false }) {
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const selected = options.find(o => o.value === value);

  if (!isMobile) {
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
        className={`w-full flex items-center justify-between border border-input rounded-md px-3 h-9 text-sm bg-background disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground truncate'}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className="w-4 h-4 opacity-50 flex-shrink-0 ml-2" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{label || placeholder || 'Select'}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-1 overflow-y-auto max-h-[60vh]">
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                className={`w-full flex items-center justify-between text-left px-4 py-3 rounded-xl text-sm transition-colors ${
                  value === o.value
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'hover:bg-gray-50 text-gray-800'
                }`}
                onClick={() => { onValueChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {value === o.value && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}