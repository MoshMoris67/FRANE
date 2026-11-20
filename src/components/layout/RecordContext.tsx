import { createContext, useContext, useState, type ReactNode } from 'react'
import TransactionDialog from '../../features/transactions/TransactionDialog'

const Ctx = createContext<{ openRecord: (mode?: 'transaction' | 'transfer') => void }>({ openRecord: () => {} })
export const useRecord = () => useContext(Ctx)

export function RecordProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; mode: 'transaction' | 'transfer' }>({ open: false, mode: 'transaction' })
  return (
    <Ctx.Provider value={{ openRecord: (mode = 'transaction') => setState({ open: true, mode }) }}>
      {children}
      {state.open && <TransactionDialog initialMode={state.mode} onClose={() => setState((s) => ({ ...s, open: false }))} />}
    </Ctx.Provider>
  )
}
