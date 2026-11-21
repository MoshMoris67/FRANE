import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { presetRange, PRESET_LABEL, type Preset, type Range } from '../../lib/dates'
import { fmtDate, today } from '../../lib/format'

interface Ctx { preset: Preset; setPreset: (p: Preset) => void; custom: Range; setCustom: (r: Range) => void; range: Range; valid: boolean; label: string }
const C = createContext<Ctx>(null as unknown as Ctx)
export const usePeriod = () => useContext(C)

/** One reporting period shared by the header selector and the dashboard. */
export function PeriodProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState<Range>({ from: today(), to: today() })
  const v = useMemo<Ctx>(() => {
    const range = preset === 'custom' ? custom : presetRange(preset)
    return { preset, setPreset, custom, setCustom, range, valid: range.from <= range.to, label: preset === 'custom' ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : PRESET_LABEL[preset] }
  }, [preset, custom])
  return <C.Provider value={v}>{children}</C.Provider>
}
