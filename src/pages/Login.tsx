import { useState, type FormEvent, type ReactNode } from 'react'
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, LineChart, Settings2, User } from 'lucide-react'
import clsx from 'clsx'
import { supabase, isConfigured, errMsg } from '../lib/supabase'
import { LogoMark } from '../components/Logo'
import { Notice } from '../components/ui'

type Mode = 'in' | 'up' | 'reset'
const PHOTO = '/factory-banner.jpg'

/** Wordmark used over the photo. */
function Wordmark({ size }: { size: 'lg' | 'sm' }) {
  return (
    <div className={clsx('flex items-end', size === 'lg' ? 'gap-4' : 'gap-3')}>
      <LogoMark size={size === 'lg' ? 64 : 44} />
      <div className="leading-none">
        <p className={clsx('font-display font-semibold tracking-[0.03em] text-white', size === 'lg' ? 'text-[3.2rem]' : 'text-[2.1rem]')}>FRANE</p>
        <p className={clsx('mt-1 font-semibold tracking-[0.08em] text-white', size === 'lg' ? 'text-base' : 'text-[11px]')}>CONCRETE FACTORY</p>
      </div>
    </div>
  )
}

function IconInput({ icon: Icon, label, right, ...p }: { icon: typeof Mail; label: string; right?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Icon size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate2-500" />
      <input aria-label={label} placeholder={label} {...p} className="h-[52px] w-full rounded-md border border-slate2-300 bg-white pl-12 pr-12 text-base text-charcoal-900 placeholder:text-slate2-500 focus:border-charcoal-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 lg:h-14" />
      {right}
    </label>
  )
}

function PasswordInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <IconInput icon={Lock} label={label} type={show ? 'text' : 'password'} required value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
      right={<button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-slate2-600 hover:text-charcoal-900">{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>} />
  )
}

/** Shared shell: photo panel + form panel. Desktop is a 55/45 split; phone is a photo header that flows into the form. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate2-50 lg:flex-row">
      {/* photo */}
      <section aria-label="FRANE CONCRETE FACTORY" className="relative isolate h-[30dvh] min-h-[190px] max-h-[280px] shrink-0 overflow-hidden bg-charcoal-900 bg-cover bg-[position:62%_55%] lg:h-auto lg:max-h-none lg:min-h-dvh lg:w-[55%] lg:bg-[position:58%_50%]" style={{ backgroundImage: `url(${PHOTO})` }}>
        <div className="absolute inset-0 bg-gradient-to-b from-charcoal-950/70 via-charcoal-950/25 to-charcoal-950/70 lg:bg-gradient-to-t lg:from-charcoal-950/90 lg:via-charcoal-950/25 lg:to-charcoal-950/55" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-charcoal-950/55 to-transparent lg:block" />
        <div className="relative z-10 flex h-full flex-col justify-center px-6 lg:justify-between lg:px-14 lg:py-12">
          <div className="flex justify-center lg:justify-start"><span className="lg:hidden"><Wordmark size="sm" /></span><span className="hidden lg:block"><Wordmark size="lg" /></span></div>
          <div className="hidden lg:block">
            <h1 className="font-display text-[4.2rem] font-semibold uppercase leading-[0.98] tracking-tight text-white xl:text-[5rem]">Every shilling.<br /><span className="text-brand-500">Every block.</span><br />Accounted for.</h1>
            <div className="mt-6 h-[3px] w-24 bg-brand-500" />
            <p className="mt-5 max-w-sm text-lg text-slate2-100">Cash, sales, production and stock — one reliable system.</p>
            <ul className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-slate2-100">
              {([[ShieldCheck, 'Secure Records'], [LineChart, 'Real-Time Insights'], [Settings2, 'Smarter Management']] as const).map(([Ic, t]) => <li key={t} className="flex items-center gap-2.5"><Ic size={22} className="text-brand-500" strokeWidth={1.6} />{t}</li>)}
            </ul>
          </div>
        </div>
        {/* orange sweep: the corner on desktop, the diagonal into the form on phones */}
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-x-0 bottom-0 z-10 h-7 w-full lg:hidden"><path d="M0 12 L100 0 L100 12Z" fill="#f6f5f2" /><path d="M0 12 L100 0" stroke="#c8651f" strokeWidth="1.6" vectorEffect="non-scaling-stroke" fill="none" /></svg>
        <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true" className="absolute bottom-0 right-0 z-10 hidden h-16 w-64 lg:block"><path d="M0 60 L200 0 L200 18 L52 60Z" fill="#c8651f" /></svg>
      </section>
      {/* form */}
      <section className="relative flex flex-1 items-start justify-center px-5 pb-8 pt-3 sm:px-8 lg:w-[45%] lg:flex-none lg:items-center lg:px-12 lg:py-10">
        <div className="w-full max-w-[420px]">{children}</div>
      </section>
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)
  const go = (m: Mode) => { setMode(m); setMsg(null) }

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'up') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.')
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) throw error
        if (!data.session) setMsg({ tone: 'green', text: 'Account created. Check your email to confirm, then sign in.' })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setMsg({ tone: 'green', text: 'If that email has an account, a reset link is on its way. Open it on this device.' })
      }
    } catch (err) { setMsg({ tone: 'red', text: errMsg(err) }) } finally { setBusy(false) }
  }

  const title = mode === 'in' ? 'Sign in to FRANE' : mode === 'up' ? 'Create your account' : 'Reset your password'
  const sub = mode === 'in' ? 'Access your factory’s financial and management system.' : mode === 'up' ? 'New staff member? Register, then the Owner will give you access.' : 'Enter your email and we’ll send you a link to choose a new password.'

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-3.5 lg:space-y-4">
        <div className="hidden items-center gap-4 lg:flex"><span className="h-px flex-1 bg-slate2-300" /><span className="text-xs font-semibold tracking-[0.3em] text-brand-600">WELCOME BACK</span><span className="h-px flex-1 bg-slate2-300" /></div>
        <div className="text-center">
          <h2 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight text-charcoal-900 lg:text-[2.4rem]">{title}</h2>
          <p className="mx-auto mt-1 max-w-[22rem] text-sm text-slate2-600 lg:mt-2 lg:text-base">{sub}</p>
        </div>
        {!isConfigured && <Notice tone="amber">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set your project URL and anon key.</Notice>}
        {mode === 'up' && <IconInput icon={User} label="Full name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        <IconInput icon={Mail} label="Email Address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
        {mode !== 'reset' && <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />}
        {mode === 'in' && <div className="-mt-1 text-right"><button type="button" onClick={() => go('reset')} className="inline-flex min-h-9 items-center text-sm font-semibold text-brand-600 hover:text-brand-700">Forgot password?</button></div>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <button disabled={busy} className="btn-primary flex h-[52px] w-full items-center justify-center gap-2 !rounded-md text-base lg:h-14">{busy ? 'Please wait…' : <>{mode === 'in' ? 'Sign In' : mode === 'up' ? 'Create account' : 'Send reset link'}<ArrowRight size={18} /></>}</button>
        <div className="flex items-center gap-3 text-xs text-slate2-600"><span className="h-px flex-1 bg-slate2-300" /><span className="flex items-center gap-1.5"><Lock size={13} />Secure access for your team</span><span className="h-px flex-1 bg-slate2-300" /></div>
        <p className="text-center text-sm text-slate2-700">
          {mode === 'in' ? 'New staff member? ' : mode === 'up' ? 'Already registered? ' : 'Remembered it? '}
          <button type="button" className="inline-flex min-h-9 items-center font-semibold text-brand-600 hover:text-brand-700" onClick={() => go(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Create an account' : 'Sign in'}</button>
        </p>
        {mode === 'up' && <p className="text-center text-xs text-slate2-500">The first account becomes the Owner. Later accounts must be given a role by the Owner before they can see any data.</p>}
      </form>
    </Shell>
  )
}

/** Shown after the user opens the emailed reset link (Supabase signs them in with a short-lived recovery session). */
export function SetNewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    if (pw.length < 8) return setMsg('Password must be at least 8 characters.')
    if (pw !== pw2) return setMsg('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg(errMsg(error))
    onDone()
  }
  return (
    <Shell>
      <form onSubmit={submit} className="space-y-3.5 lg:space-y-4">
        <div className="text-center"><h2 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight lg:text-[2.4rem]">Choose a new password</h2><p className="mt-1 text-sm text-slate2-600 lg:text-base">Use at least 8 characters.</p></div>
        <PasswordInput label="New password" value={pw} onChange={setPw} autoComplete="new-password" />
        <PasswordInput label="Repeat new password" value={pw2} onChange={setPw2} autoComplete="new-password" />
        {msg && <Notice tone="red">{msg}</Notice>}
        <button disabled={busy} className="btn-primary flex h-[52px] w-full items-center justify-center gap-2 !rounded-md text-base lg:h-14">{busy ? 'Saving…' : <>Save password<ArrowRight size={18} /></>}</button>
      </form>
    </Shell>
  )
}
