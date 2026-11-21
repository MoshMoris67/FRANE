/** Copies each column header onto its cells (data-label) so `table.stack` can show labelled cards on phones. Safe to call repeatedly. */
export function labelStackTables(root: ParentNode = document) {
  root.querySelectorAll<HTMLTableElement>('table.stack').forEach((t) => {
    const heads = Array.from(t.querySelectorAll('thead th')).map((h) => (h.textContent ?? '').trim())
    if (!heads.length) return
    t.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.children) as HTMLElement[]
      if (cells.length !== heads.length) return           // empty-state / total rows keep their own layout
      cells.forEach((c, i) => { if (heads[i]) { if (c.getAttribute('data-label') !== heads[i]) c.setAttribute('data-label', heads[i]) } else if (i > 0) c.classList.add('stack-actions') })   // header-less column = row actions
    })
  })
}

/** Watches the page and labels tables as they render. Returns a stop function. */
export function watchStackTables(root: HTMLElement): () => void {
  let raf = 0
  const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => labelStackTables(root)) }
  const mo = new MutationObserver(run); mo.observe(root, { childList: true, subtree: true })
  run()
  return () => { mo.disconnect(); cancelAnimationFrame(raf) }
}
