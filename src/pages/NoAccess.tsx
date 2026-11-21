import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Logo'

export default function NoAccess() {
  const { signOut, session, perms } = useAuth()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-charcoal-900 px-6 text-center">
      <Brand />
      <ShieldAlert className="mt-10 text-brand-500" size={40} />
      <h1 className="mt-3 font-display text-3xl font-bold text-white">{perms && !perms.active ? 'Account disabled' : 'Awaiting access'}</h1>
      <p className="mt-2 max-w-sm text-slate2-300">{perms && !perms.active ? 'Your account has been deactivated. Contact the Owner.' : `You're signed in as ${session?.user.email}, but the Owner hasn't assigned you a role yet. Ask them to grant access in Settings → Users.`}</p>
      <button className="btn-primary mt-6" onClick={signOut}>Sign out</button>
    </div>
  )
}
