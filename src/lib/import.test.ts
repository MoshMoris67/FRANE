import { describe, it, expect } from 'vitest'
import { parseCSV, normalizeNumber, normalizeDate, autoMap, buildRows, csvTemplate } from './import'
import { IMPORT_KINDS } from '../features/import/kinds'

describe('parseCSV', () => {
  it('handles quotes, escaped quotes, commas and newlines inside cells', () => {
    expect(parseCSV('a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', 'z']])
  })
  it('strips a BOM, skips blank lines, trims cells', () => { expect(parseCSV('﻿Name , Phone\n\n Ann , 0700 \n')).toEqual([['Name', 'Phone'], ['Ann', '0700']]) })
  it('detects semicolon and tab delimiters', () => { expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]); expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]) })
  it('keeps a final row without trailing newline', () => { expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]) })
})

describe('normalizeNumber', () => {
  it.each([['1,500,000', '1500000'], ['UGX 2,500', '2500'], ['1 250 000', '1250000'], ['(2,500)', '-2500'], ['-40', '-40'], ['3.50', '3.50'], ['', ''], ['Shs. 10,000', '10000']])('%s → %s', (a, b) => expect(normalizeNumber(a)).toBe(b))
  it('leaves garbage unchanged so the server can reject it', () => { expect(normalizeNumber('abc')).toBe('abc'); expect(normalizeNumber('12abc')).toBe('12abc') })
})

describe('normalizeDate', () => {
  it('ISO and day-first (Uganda) formats', () => {
    expect(normalizeDate('2026-03-07')).toBe('2026-03-07'); expect(normalizeDate('07/03/2026')).toBe('2026-03-07'); expect(normalizeDate('7-3-26')).toBe('2026-03-07'); expect(normalizeDate('07.03.2026')).toBe('2026-03-07')
  })
  it('ambiguous dates are read day-first; clearly month-first is respected', () => { expect(normalizeDate('05/06/2026')).toBe('2026-06-05'); expect(normalizeDate('03/25/2026')).toBe('2026-03-25') })
  it('Excel serials and Date objects', () => { expect(normalizeDate('45000')).toBe('2023-03-15'); expect(normalizeDate(new Date(2026, 10, 20))).toBe('2026-11-20') })
  it('rejects impossible or unreadable dates', () => { expect(normalizeDate('31/02/2026')).toBeNull(); expect(normalizeDate('hello')).toBeNull(); expect(normalizeDate('')).toBeNull(); expect(normalizeDate('13/13/2026')).toBeNull() })
})

describe('mapping and row building', () => {
  const kind = IMPORT_KINDS.find((k) => k.id === 'opening_receivables')!
  it('auto-maps by label, key or alias, ignoring case and punctuation', () => {
    const m = autoMap(['Customer Name', 'Balance', 'Date', 'Book Ref', 'Due date'], kind.fields)
    expect(m).toMatchObject({ customer: 0, amount: 1, invoice_date: 2, reference: 3, due_date: 4 })
  })
  it('reports unmapped columns as null', () => { expect(autoMap(['Foo'], kind.fields).amount).toBeNull() })
  it('builds typed rows with spreadsheet row numbers', () => {
    const m = autoMap(['Customer', 'Amount owed', 'Invoice date'], kind.fields)
    const rows = buildRows(kind.fields, m, [['Mukasa', 'UGX 750,000', '05/11/2026'], ['Nakato', '(1,000)', new Date(2026, 0, 2)]])
    expect(rows[0]).toMatchObject({ _row: 2, customer: 'Mukasa', amount: '750000', invoice_date: '2026-11-05' })
    expect(rows[1]).toMatchObject({ _row: 3, amount: '-1000', invoice_date: '2026-01-02' })
  })
  it('every import kind has unique field keys and at least one required field', () => {
    for (const k of IMPORT_KINDS) { expect(new Set(k.fields.map((f) => f.key)).size).toBe(k.fields.length); expect(k.fields.some((f) => f.required)).toBe(true) }
    expect(new Set(IMPORT_KINDS.map((k) => k.id)).size).toBe(IMPORT_KINDS.length)
  })
  it('templates are header-only CSV', () => { expect(csvTemplate(kind.fields).split('\r\n')[0]).toContain('Amount owed') ; expect(csvTemplate(kind.fields).split('\r\n')[1]).toBe('') })
})
