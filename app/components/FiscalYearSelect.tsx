'use client'

import {
  formatFiscalYearLabel,
  getFiscalYearDateRange,
  listSelectableFiscalYears,
} from '@/lib/fiscal-year'

type Props = {
  value: number
  onChange: (year: number) => void
  className?: string
  label?: string
  hint?: boolean
}

export default function FiscalYearSelect({
  value,
  onChange,
  className = '',
  label = '会計年度',
  hint = true,
}: Props) {
  const range = getFiscalYearDateRange(value)
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {listSelectableFiscalYears().map((year) => (
          <option key={year} value={year}>
            {formatFiscalYearLabel(year)}（{year}）
          </option>
        ))}
      </select>
      {hint ? (
        <p className="mt-1 text-[11px] text-slate-500">
          {formatFiscalYearLabel(value)} = {range.start.replace(/-/g, '/')} 〜 {range.end.replace(/-/g, '/')}
        </p>
      ) : null}
    </div>
  )
}
