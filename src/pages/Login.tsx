import { useState, type FormEvent } from 'react'
import { supabase, isConfigured, errMsg } from '../lib/supabase'
import { Brand } from '../components/Logo'
import { Field, Notice } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.')
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) throw error
        if (!data.session) setMsg({ tone: 'green', text: 'Account created. Check your email to confirm, then sign in.' })
      }
    } catch (err) { setMsg({ tone: 'red', text: errMsg(err) }) } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-charcoal-900 p-12 lg:flex">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'repeating-linear-gradient(0deg,#fff 0 1px,transparent 1px 56px),repeating-linear-gradient(90deg,#fff 0 1px,transparent 1px 112px)' }} />
        <Brand />
        <div className="relative">
          <h1 className="font-display text-6xl font-bold uppercase leading-[0.95] text-white">Every shilling.<br /><span className="text-brand-500">Every block.</span><br />Accounted for.</h1>
          <p className="mt-6 max-w-md text-slate2-300">Cash, sales, production and stock — one reliable system replacing the handwritten books.</p>
        </div>
        <p className="relative text-xs text-slate2-500">Concrete blocks · Pavers · Construction products — Uganda</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden"><Brand light={false} /></div>
          <div><h2 className="font-display text-3xl font-bold">{mode === 'in' ? 'Sign in' : 'Create account'}</h2>
            <p className="text-sm text-slate2-500">FRANE CONCRETE FACTORY management system</p></div>
          {!isConfigured && <Notice tone="amber">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set your project URL and anon key.</Notice>}
          {mode === 'up' && <Field label="Full name"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          <Field label="Password"><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></Field>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <button className="btn-primary w-full !py-2.5" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
          <p className="text-center text-sm text-slate2-500">
            {mode === 'in' ? 'New staff member? ' : 'Already registered? '}
            <button type="button" className="font-semibold text-brand-600" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}>{mode === 'in' ? 'Create an account' : 'Sign in'}</button>
          </p>
          {mode === 'up' && <p className="text-center text-xs text-slate2-400">The first account becomes the Owner. Later accounts must be given a role by the Owner before they can see any data.</p>}
        </form>
      </div>
    </div>
  )
}
