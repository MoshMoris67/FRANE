import { useMemo, useState } from 'react'
import { Download, Upload, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { Notice, Spinner } from '../../components/ui'
import { supabase, errMsg } from '../../lib/supabase'
import { IMPORT_KINDS, type ImportKind } from './kinds'
import { autoMap, buildRows, csvTemplate, readTable } from '../../lib/import'
import { useRefreshMoney } from '../data'
import { toast } from '../../components/toast'

interface Result { created: number; skipped: number; errors: number; committed: boolean; results: { row: number; status: 'created' | 'skipped' | 'error'; message: string | null }[] }

export default function ImportTab() {
  const refresh = useRefreshMoney()
  const [kind, setKind] = useState<ImportKind | null>(null)
  const [file, setFile] = useState<File | null>(null); const [table, setTable] = useState<{ headers: string[]; rows: unknown[][] } | null>(null)
  const [map, setMap] = useState<Record<string, number | null>>({}); const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  const [dry, setDry] = useState<Result | null>(null); const [done, setDone] = useState<Result | null>(null)

  const rows = useMemo(() => (kind && table ? buildRows(kind.fields, map, table.rows) : []), [kind, table, map])
  const missing = kind ? kind.fields.filter((f) => f.required && map[f.key] == null) : []

  function reset() { setKind(null); setFile(null); setTable(null); setMap({}); setDry(null); setDone(null); setError('') }
  async function onFile(f: File) {
    setError(''); setDry(null); setDone(null); setFile(f)
    try { const t = await readTable(f); if (t.rows.length === 0) return setError('That file has no data rows.'); setTable(t); setMap(autoMap(t.headers, kind!.fields)) }
    catch (e) { setError(`Could not read the file: ${errMsg(e)}`) }
  }
  async function run(commit: boolean) {
    if (!kind) return; setBusy(commit ? 'commit' : 'check'); setError('')
    const { data, error: e } = await supabase.rpc('import_data', { p_kind: kind.id, p_rows: rows, p_dry_run: !commit, p_filename: file?.name ?? null })
    setBusy('')
    if (e) return setError(errMsg(e))
    const r = data as Result
    if (commit) { setDone(r); setDry(null); await refresh(); toast(`Imported ${r.created} row(s)`) } else setDry(r)
  }
  function download(k: ImportKind) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csvTemplate(k.fields)], { type: 'text/csv;charset=utf-8' })); a.download = `template_${k.id}.csv`; document.body.appendChild(a); a.click(); a.remove()
  }

  if (!kind) return (
    <div className="space-y-4">
      <Notice tone="neutral">Move your handwritten books into the system in this order. Each file is checked first (nothing is saved until you confirm), is all-or-nothing, and the same file can’t be imported twice. Excel (.xlsx) and CSV are supported — up to 2,000 rows per file.</Notice>
      <div className="grid gap-3 md:grid-cols-2">{IMPORT_KINDS.map((k) => (
        <div key={k.id} className="card flex flex-col justify-between gap-3 p-4">
          <div><p className="text-xs font-bold text-brand-600">Step {k.step}</p><p className="mt-0.5 font-semibold">{k.title}</p><p className="mt-1 text-sm text-slate2-500">{k.description}</p></div>
          <div className="flex gap-2"><button className="btn-primary !py-1.5" onClick={() => setKind(k)}><Upload size={14} />Import</button><button className="btn-ghost !py-1.5" onClick={() => download(k)}><Download size={14} />Template</button></div>
        </div>))}</div>
    </div>
  )

  if (done) return (
    <div className="card max-w-xl space-y-3 p-6 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={38} /><h3 className="font-display text-2xl font-bold">Import complete</h3>
      <p className="text-sm text-slate2-600"><b>{done.created}</b> created · <b>{done.skipped}</b> skipped (already existed).</p>
      {done.results.filter((r) => r.message && r.status === 'created').slice(0, 5).map((r) => <Notice key={r.row} tone="amber">Row {r.row}: {r.message}</Notice>)}
      <button className="btn-primary" onClick={reset}>Import something else</button></div>
  )

  return (
    <div className="space-y-4">
      <button className="text-sm text-slate2-500 hover:text-charcoal-900" onClick={reset}>← All imports</button>
      <div><h3 className="font-display text-2xl font-bold">{kind.title}</h3><p className="text-sm text-slate2-500">{kind.description}</p></div>
      {kind.warning && <Notice tone="amber"><AlertTriangle size={14} className="mr-1 inline" />{kind.warning}</Notice>}
      <div className="card p-4"><label className="btn-ghost cursor-pointer"><Upload size={15} />{file ? 'Choose a different file' : 'Choose CSV or Excel file'}<input type="file" hidden accept=".csv,.xlsx,.xls,.xlsm,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
        {file && <span className="ml-3 text-sm text-slate2-600">{file.name} · {table?.rows.length ?? 0} data rows</span>}
        <button className="ml-3 text-sm font-semibold text-brand-600" onClick={() => download(kind)}>Download blank template</button></div>
      {error && <Notice tone="red">{error}</Notice>}

      {table && (<>
        <section className="card p-4"><h4 className="mb-2 text-sm font-semibold">Match your columns</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{kind.fields.map((f) => (
            <label key={f.key} className="block"><span className="label">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
              <select className={clsx('input', f.required && map[f.key] == null && 'border-red-400')} value={map[f.key] ?? ''} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value === '' ? null : Number(e.target.value) }); setDry(null) }}>
                <option value="">{f.required ? '— choose column —' : '— not in my file —'}</option>{table.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}</select>
              {f.help && <span className="mt-0.5 block text-[11px] text-slate2-500">{f.help}</span>}</label>))}</div>
          {missing.length > 0 && <p className="mt-3 text-sm text-red-600">Still needed: {missing.map((f) => f.label).join(', ')}</p>}</section>

        <section className="card overflow-x-auto"><h4 className="border-b border-slate2-200 px-4 py-3 text-sm font-semibold">Preview (first 8 rows, as they will be imported)</h4>
          <table className="w-full min-w-[560px] text-sm"><thead className="bg-slate2-50"><tr><th className="th">Row</th>{kind.fields.filter((f) => map[f.key] != null).map((f) => <th key={f.key} className="th">{f.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate2-100">{rows.slice(0, 8).map((r) => <tr key={String(r._row)}><td className="td text-slate2-400">{r._row}</td>{kind.fields.filter((f) => map[f.key] != null).map((f) => <td key={f.key} className="td">{String(r[f.key] ?? '')}</td>)}</tr>)}</tbody></table></section>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-dark" disabled={!!busy || missing.length > 0 || rows.length === 0 || rows.length > 2000} onClick={() => run(false)}>{busy === 'check' ? 'Checking…' : '1. Check the file'}</button>
          <button className="btn-primary" disabled={!!busy || !dry || dry.errors > 0 || dry.created === 0} onClick={() => run(true)}>{busy === 'commit' ? 'Importing…' : `2. Import ${dry?.created ?? 0} row(s)`}</button>
          {rows.length > 2000 && <span className="text-sm text-red-600">Too many rows — split the file (max 2,000).</span>}{busy && <Spinner label="" />}
        </div>

        {dry && (
          <section className="card"><div className="flex flex-wrap gap-4 border-b border-slate2-200 px-4 py-3 text-sm"><b className="text-emerald-700">{dry.created} ready</b><span className="text-slate2-600">{dry.skipped} will be skipped</span><b className={dry.errors ? 'text-red-600' : 'text-slate2-500'}>{dry.errors} error(s)</b></div>
            {dry.errors > 0 && <p className="border-b border-slate2-100 bg-red-50 px-4 py-2 text-sm text-red-700">Fix the rows below in your file and check again. Nothing has been saved.</p>}
            <ul className="max-h-80 divide-y divide-slate2-100 overflow-y-auto text-sm">{[...dry.results].sort((a, b) => (a.status === 'error' ? -1 : 0) - (b.status === 'error' ? -1 : 0)).filter((r) => r.status !== 'created' || r.message).slice(0, 200).map((r, i) => (
              <li key={i} className="flex items-start gap-2 px-4 py-2">{r.status === 'error' ? <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" /> : r.status === 'skipped' ? <MinusCircle size={16} className="mt-0.5 shrink-0 text-slate2-400" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />}<span><b>Row {r.row}</b> — {r.message}</span></li>))}
              {dry.results.every((r) => r.status === 'created' && !r.message) && <li className="px-4 py-3 text-emerald-700">All rows look good.</li>}</ul></section>)}
      </>)}
    </div>
  )
}
