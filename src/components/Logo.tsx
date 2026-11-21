import clsx from 'clsx'

/** FRANE mark: three concrete blocks of different heights. Flat, works on dark and light. */
export function LogoMark({ size = 36, url }: { size?: number; url?: string }) {
  if (url) return <img src={url} alt="" width={size} height={size} className="rounded-sm bg-white object-contain" style={{ width: size, height: size }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="3" y="23" width="12" height="21" fill="#c8651f" />
      <rect x="18" y="8" width="12" height="36" fill="#e0894a" />
      <rect x="33" y="16" width="12" height="28" fill="#c8651f" />
      <path d="M8 29h2M8 35h2M23 15h2M23 22h2M23 29h2M23 36h2M38 22h2M38 29h2M38 36h2" stroke="#181a1c" strokeWidth="2" strokeLinecap="square" opacity=".55" />
      <rect x="1" y="44" width="46" height="2.5" fill="#c8651f" />
    </svg>
  )
}

export function Brand({ name = 'FRANE CONCRETE FACTORY', light = true, compact, logoUrl }: { name?: string; light?: boolean; compact?: boolean; logoUrl?: string }) {
  const [first, ...rest] = name.split(' ')
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={compact ? 28 : 38} url={logoUrl} />
      <div className="leading-none">
        <div className={clsx('font-display font-semibold tracking-[0.08em]', compact ? 'text-xl' : 'text-[1.6rem]', light ? 'text-white' : 'text-charcoal-900')}>{first}</div>
        <div className={clsx('mt-1 text-[9.5px] font-medium uppercase tracking-[0.2em]', light ? 'text-slate2-400' : 'text-slate2-500')}>{rest.join(' ')}</div>
      </div>
    </div>
  )
}
