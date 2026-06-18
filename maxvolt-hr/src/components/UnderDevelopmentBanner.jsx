import { AlertTriangle } from 'lucide-react';

export default function UnderDevelopmentBanner({ pageName }) {
  return (
    <div className="bg-red-600 text-white px-4 py-2.5 text-center text-sm font-semibold flex items-center justify-center gap-2 shadow-md sticky top-0 z-30">
      <AlertTriangle className="w-4 h-4" />
      <span>UNDER DEVELOPMENT</span>
      {pageName && <span className="hidden sm:inline opacity-80">— {pageName} is being built and may not be fully functional yet</span>}
    </div>
  );
}