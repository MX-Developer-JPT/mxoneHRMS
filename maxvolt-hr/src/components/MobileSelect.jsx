import { useState, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';

/**
 * MobileSelect – searchable dropdown.
 * Desktop: Popover + Command (cmdk) with live search.
 * Mobile (<768px): bottom-sheet Drawer with a search input.
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
  const [mobileSearch, setMobileSearch] = useState('');

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const selected = options.find(o => o.value === value);

  const filteredMobile = mobileSearch
    ? options.filter(o => o.label.toLowerCase().includes(mobileSearch.toLowerCase()))
    : options;

  if (!isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
          >
            <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
              {selected?.label || placeholder}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-2" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search..." />
            <CommandList>
              <CommandEmpty>No options found.</CommandEmpty>
              {options.map(o => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => { onValueChange(o.value); setOpen(false); }}
                >
                  <Check className={`mr-2 h-4 w-4 shrink-0 ${value === o.value ? 'opacity-100' : 'opacity-0'}`} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setMobileSearch(''); setOpen(true); } }}
        className={`w-full flex items-center justify-between border border-input rounded-md px-3 h-9 text-sm bg-background disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className="w-4 h-4 opacity-50 flex-shrink-0 ml-2" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="pb-2">
            <DrawerTitle>{label || placeholder || 'Select'}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 border rounded-md px-3 bg-background">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Search..."
                value={mobileSearch}
                onChange={e => setMobileSearch(e.target.value)}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="px-4 pb-6 space-y-1 overflow-y-auto max-h-[50vh]">
            {filteredMobile.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No options found.</p>
            )}
            {filteredMobile.map(o => (
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
