import clsx from 'clsx'

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="10" fill="#ee7a26" />
      <path d="M15 14h34v9H26v7h19v9H26v11H15z" fill="#14171a" />
      <path d="M40 46h9v4h-9z" fill="#14171a" opacity=".55" />
    </svg>
  )
}

export function Brand({ name = 'FRANE CONCRETE FACTORY', light = true, compact }: { name?: string; light?: boolean; compact?: boolean }) {
  const [first, ...rest] = name.split(' ')
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={compact ? 30 : 38} />
      <div className="leading-none">
        <div className={clsx('font-display font-bold tracking-wider', compact ? 'text-lg' : 'text-xl', light ? 'text-white' : 'text-charcoal-900')}>{first}</div>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">{rest.join(' ')}</div>
      </div>
    </div>
  )
}
