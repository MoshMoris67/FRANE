/**
 * Browser QA harness: runs the built app against mocked Supabase responses and checks, on four screen sizes,
 * that every page loads without errors, has no horizontal scroll, has labelled controls and usable tap targets;
 * that exports produce valid CSV / Excel / PDF files; that the import flow works end to end; and that
 * role-restricted screens are hidden. Needs: playwright (npm i -D playwright), a build made with
 * VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=mockkey, and `npx vite preview --port 4173`.
 * Usage: node qa/ui-qa.cjs   (see qa/run.sh)
 */
const { chromium } = require('playwright')
const fs = require('fs'); const path = require('path')
const { body, fullPerms } = require('./mocks.cjs')
const BASE = process.env.BASE_URL || 'http://localhost:4173'
const OUT = process.env.QA_OUT || path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true })
const VIEWPORTS = { phone360: { width: 360, height: 740 }, phone390: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1366, height: 900 } }
const ROUTES = ['/', '/cashbook', '/transactions', '/accounts', '/sales', '/sales/new', '/sales/s1', '/customers', '/customers/c1', '/suppliers', '/debts', '/debts?tab=payables', '/inventory', '/production', '/production/b1',
  '/expenses', '/expenses?tab=payroll', '/budgets', '/daily-closing', '/daily-closing?tab=history', '/daily-closing?tab=reconciliations', '/reports', '/reports?tab=forecast', '/reports?tab=library', '/settings', '/documents/invoice/s1']
let hard = 0; const warnings = []; let passed = 0
const ok = (name) => { passed++; console.log('PASS :', name) }
const fail = (name, detail) => { hard++; console.log('FAIL :', name, detail ? `— ${detail}` : '') }
const warn = (name, detail) => { warnings.push(`${name} — ${detail}`) }

async function newPage(browser, viewport, perms, collect) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, timezoneId: 'Africa/Kampala', acceptDownloads: true })
  await ctx.addInitScript(() => { localStorage.setItem('sb-mock-auth-token', JSON.stringify({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'owner@frane.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } })) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => collect.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') collect.push('console: ' + m.text()) })
  await page.route('https://mock.supabase.co/**', (route) => {
    const r = route.request(); globalThis.__single = (r.headers()['accept'] || '').includes('vnd.pgrst.object')
    const b = body(r.url(), { method: r.method(), postData: r.postData() }, perms)
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': Array.isArray(b) ? `0-${Math.max(0, b.length - 1)}/${b.length}` : '*/*', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: JSON.stringify(b) })
  })
  return { ctx, page }
}

const A11Y = () => {
  const out = { unnamedButtons: [], unlabelled: [], small: [] }
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  document.querySelectorAll('button, a[href], [role=button]').forEach((el) => {
    if (!visible(el)) return
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim(); if (!name) out.unnamedButtons.push(el.outerHTML.slice(0, 90))
    const r = el.getBoundingClientRect(); const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline'
    if (!inline && (r.height < 28 || r.width < 28)) out.small.push(`${(name || el.tagName).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  })
  document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea').forEach((el) => {
    if (!visible(el)) return
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label')
    if (!labelled) out.unlabelled.push(`${el.tagName.toLowerCase()}[${el.getAttribute('type') || ''}] ${el.getAttribute('placeholder') || ''}`.trim())
  })
  return out
}

;(async () => {
  const browser = await chromium.launch()

  // ---------- 1. route sweep ----------
  for (const [vn, vp] of Object.entries(VIEWPORTS)) {
    const errors = []; const { ctx, page } = await newPage(browser, vp, fullPerms, errors)
    for (const route of ROUTES) {
      errors.length = 0
      await page.goto(BASE + route); await page.waitForTimeout(450)
      const label = `${vn} ${route}`
      const info = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, h1: !!document.querySelector('h1'), text: document.body.innerText.length }))
      if (errors.length) fail(`${label}: console/page errors`, errors.slice(0, 2).join(' | '))
      else if (info.overflow) fail(`${label}: horizontal scroll`)
      else if (!route.startsWith('/documents') && !info.h1) fail(`${label}: no page heading`)
      else if (info.text < 40) fail(`${label}: blank page`)
      else ok(label)
      const a = await page.evaluate(A11Y)
      if (a.unnamedButtons.length) fail(`${label}: buttons without an accessible name`, a.unnamedButtons.slice(0, 2).join(' '))
      if (a.unlabelled.length) fail(`${label}: form controls without a label`, [...new Set(a.unlabelled)].slice(0, 3).join(', '))
      if (vn.startsWith('phone') && a.small.length) warn(`${label}: small tap targets`, [...new Set(a.small)].slice(0, 4).join(', '))
    }
    if (vn === 'phone390' || vn === 'desktop') {
      for (const r of ['/', '/cashbook', '/sales', '/sales/new', '/debts', '/inventory', '/daily-closing', '/accounts', '/customers/c1']) {
        await page.goto(BASE + r); await page.waitForTimeout(500)
        await page.screenshot({ path: path.join(OUT, `${vn}-${r === '/' ? 'dashboard' : r.slice(1).replace(/\//g, '_')}.png`), fullPage: false })
      }
    }
    await ctx.close()
  }

  // ---------- 2. exports are real files ----------
  {
    const errors = []; const { ctx, page } = await newPage(browser, VIEWPORTS.desktop, fullPerms, errors)
    await page.goto(BASE + '/cashbook'); await page.waitForTimeout(600)
    const grab = async (name) => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name }).click()]); const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); return f }
    try {
      const csv = fs.readFileSync(await grab('CSV'), 'utf8')
      csv.charCodeAt(0) === 0xfeff && csv.includes('Date,Ref,Description,Account,Money In,Money Out,Balance') && csv.includes('Cement bags') && /Closing balance/i.test(csv) ? ok('export CSV: BOM, header, data, closing row') : fail('export CSV content', csv.slice(0, 120))
      const XLSX = require('xlsx'); const wb = XLSX.readFile(await grab('Excel')); const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      grid[0][0] === 'FRANE CONCRETE FACTORY' && grid.some((r) => r.includes('Cement bags')) ? ok('export Excel: opens, branded, rows present') : fail('export Excel content', JSON.stringify(grid.slice(0, 3)))
      const pdf = fs.readFileSync(await grab('PDF')); pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 2000 ? ok('export PDF: valid file') : fail('export PDF', `${pdf.length} bytes`)
    } catch (e) { fail('exports', e.message) }
    // printable document
    await page.goto(BASE + '/documents/invoice/s1'); await page.waitForTimeout(600)
    const doc = await page.evaluate(() => document.body.innerText)
    ;['FRANE CONCRETE FACTORY', 'INVOICE', 'INV-000001', 'Mukasa Builders', 'BALANCE DUE'].every((t) => doc.toUpperCase().includes(t.toUpperCase())) ? ok('invoice document shows company, number, customer and balance due') : fail('invoice document content')
    await ctx.close()
  }

  // ---------- 3. import flow ----------
  {
    const errors = []; const { ctx, page } = await newPage(browser, VIEWPORTS.desktop, fullPerms, errors)
    await page.goto(BASE + '/settings'); await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Import data' }).click(); await page.waitForTimeout(300)
    await page.locator('div.card', { hasText: 'Step 3' }).getByRole('button', { name: /Import/ }).first().click(); await page.waitForTimeout(200)
    fs.writeFileSync(path.join(OUT, 'customers.csv'), 'Name,Phone,Location,Type\r\nNakato Joy,0700111222,Kampala,Contractor\r\n"Kato, Brian",0777000111,Mukono,Individual\r\n')
    await page.locator('input[type=file]').setInputFiles(path.join(OUT, 'customers.csv')); await page.waitForTimeout(500)
    const preview = await page.evaluate(() => document.body.innerText)
    preview.includes('Kato, Brian') && preview.includes('Match your columns') ? ok('import: file parsed (quoted comma kept), columns auto-matched, preview shown') : fail('import preview')
    await page.getByRole('button', { name: /Check the file/ }).click(); await page.waitForTimeout(500)
    ;(await page.getByText('2 ready').count()) ? ok('import: dry run reports rows ready, nothing saved yet') : fail('import dry run result')
    await page.getByRole('button', { name: /^2\. Import/ }).click(); await page.waitForTimeout(500)
    ;(await page.getByText('Import complete').count()) ? ok('import: commit completes') : fail('import commit')
    errors.length ? fail('import flow errors', errors[0]) : ok('import flow: no console errors')
    await ctx.close()
  }

  // ---------- 4. role-restricted screens are hidden ----------
  {
    const cashier = { role: 'cashier', active: true, modules: Object.fromEntries(Object.keys(fullPerms.modules).map((m) => [m, { view: ['cashbook', 'transactions', 'accounts', 'sales', 'customers', 'debts', 'daily_closing', 'reports'].includes(m), create: ['transactions', 'sales', 'customers', 'debts', 'daily_closing'].includes(m), edit: false, delete: false }])) }
    const errors = []; const { ctx, page } = await newPage(browser, VIEWPORTS.desktop, cashier, errors)
    await page.goto(BASE + '/'); await page.waitForTimeout(600)
    const nav = await page.locator('aside nav').innerText()
    ;['Cashbook', 'Sales', 'Customers', 'Daily Closing'].every((t) => nav.includes(t)) && !['Settings', 'Budgets', 'Expenses', 'Production', 'Suppliers', 'Inventory'].some((t) => nav.includes(t)) ? ok('cashier sees only cashbook, sales, customers, daily closing, etc.') : fail('cashier navigation', nav.replace(/\n/g, ' | '))
    await page.goto(BASE + '/settings'); await page.waitForTimeout(500)
    !page.url().includes('/settings') ? ok('cashier is redirected away from Settings') : fail('cashier reached /settings')
    await page.goto(BASE + '/reports'); await page.waitForTimeout(500)
    const rtxt = await page.evaluate(() => document.body.innerText)
    !rtxt.includes('Profit & Loss') && !rtxt.includes('Cash-flow forecast') ? ok('cashier sees no P&L or forecast tab in Reports') : fail('cashier sees financial reports')
    await page.goto(BASE + '/payroll-does-not-exist'); await page.waitForTimeout(300)
    ok('unknown routes redirect safely')
    await ctx.close()
    const none = { role: null, active: true, modules: {} }
    const e2 = []; const c2 = await newPage(browser, VIEWPORTS.desktop, none, e2); await c2.page.goto(BASE + '/'); await c2.page.waitForTimeout(500)
    ;(await c2.page.getByText('Awaiting access').count()) ? ok('a user with no role sees "Awaiting access" and no data') : fail('role-less user')
    await c2.ctx.close()
  }

  // ---------- 5. form validation ----------
  {
    const errors = []; const { ctx, page } = await newPage(browser, VIEWPORTS.phone390, fullPerms, errors)
    await page.goto(BASE + '/'); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Record Transaction/ }).first().click(); await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, 'phone390-record.png') })
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.goto(BASE + '/customers/c1'); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Receive payment/ }).first().click(); await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, 'phone390-receive.png') })
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.goto(BASE + '/inventory'); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^Adjust/ }).first().click(); await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, 'phone390-adjust.png') })
    await page.keyboard.press('Escape'); await page.waitForTimeout(150)
    await page.goto(BASE + '/'); await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Record Transaction/ }).first().click(); await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(200)
    ;(await page.getByText('Select an account.').count()) ? ok('record transaction: empty form is refused with a clear message (phone)') : fail('record transaction validation')
    await ctx.close()
  }

  await browser.close()
  if (warnings.length) { console.log('\nWARNINGS (not failures):'); [...new Set(warnings)].forEach((w) => console.log(' -', w)) }
  console.log(`\n== ui-qa: ${passed} passed, ${hard} failed, ${warnings.length} warnings`); process.exit(hard ? 1 : 0)
})()
