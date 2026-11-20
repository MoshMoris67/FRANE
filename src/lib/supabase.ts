import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'))

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

/** Turns a Postgres/Supabase error into a readable message (strips our CODE: prefixes). */
export function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  return m.replace(/^(FORBIDDEN|INVALID|INSUFFICIENT_FUNDS|DUPLICATE_SUSPECTED|ACCOUNT_NOT_EMPTY|LEDGER_PROTECTED):\s*/, '')
}
export const isDuplicate = (e: unknown) => ((e as { message?: string })?.message ?? '').startsWith('DUPLICATE_SUSPECTED')
