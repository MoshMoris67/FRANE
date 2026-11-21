/** Receipts and supporting documents: same limits the Storage bucket enforces (so the user sees a clear message first). */
export const ATTACH_MAX_BYTES = 5 * 1024 * 1024
export const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
export const ATTACH_ACCEPT = ATTACH_TYPES.join(',')

/** Splits picked files into accepted ones and a single readable problem message (or '' when all are fine). */
export function checkAttachments(picked: File[], already = 0, maxFiles = 8): { ok: File[]; problem: string } {
  const ok: File[] = []; const bad: string[] = []
  for (const f of picked) {
    if (!ATTACH_TYPES.includes(f.type)) bad.push(`${f.name}: use a photo (JPG, PNG, WebP) or a PDF`)
    else if (f.size > ATTACH_MAX_BYTES) bad.push(`${f.name}: larger than 5 MB`)
    else if (already + ok.length >= maxFiles) bad.push(`${f.name}: at most ${maxFiles} files`)
    else ok.push(f)
  }
  return { ok, problem: bad.join(' · ') }
}
/** Safe storage file name: letters, digits, dot, dash, underscore only. */
export const safeName = (n: string) => n.replace(/[^\w.\-]+/g, '_').slice(-80)
