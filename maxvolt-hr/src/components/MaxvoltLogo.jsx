export default function MaxvoltLogo({ className = "h-8 w-auto", showText = false }) {
  return (
    <div className={`flex items-center gap-2.5 ${showText ? '' : ''}`}>
      <img
        src="/maxvolt-logo.jpg?v=2"
        alt="Maxvolt Energy"
        className={className}
        style={{ objectFit: 'contain' }}
      />
      {showText && (
        <div>
          <div className="font-bold text-sm leading-tight text-sidebar-foreground">Maxvolt One</div>
          <div className="text-[10px] text-sidebar-foreground/60 font-medium leading-tight">Energizing future</div>
        </div>
      )}
    </div>
  );
}
