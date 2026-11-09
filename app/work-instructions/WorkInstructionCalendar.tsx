'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { INSTRUCTION_SHOPS } from '@/lib/work-instruction-progress'

export type CalendarShopMark = {
  code: string
  name: string
  startedOns: string[]
  /** 一覧で着手になっている。日付が無い着手もある */
  started: boolean
  assigned: boolean
}

export type CalendarInstruction = {
  id: string
  label: string
  name: string
  occurredOn: string | null
  dueOn: string | null
  dueText: string | null
  completedOn: string | null
  shops: CalendarShopMark[]
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const ROW_H = 28
const BLOCK_ROWS = 1 + INSTRUCTION_SHOPS.length
const BLOCK_H = ROW_H * BLOCK_ROWS
const NO_W = 132
const NAME_W = 168
const SHOP_W = 56
const LABEL_W = NO_W + NAME_W + SHOP_W
const DAY_W = 52
const SPAN_MONTHS = 3
const MONTH_H = 22
const DAY_H = 36
const HEADER_H = MONTH_H + DAY_H

type Mark = { kind: string; className: string; title: string }

function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function isoFromParts(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function rangeLabel(start: Date, months: number) {
  const end = new Date(start.getFullYear(), start.getMonth() + months - 1, 1)
  const startText = `${start.getFullYear()}年${start.getMonth() + 1}月`
  const endText = start.getFullYear() === end.getFullYear() ? `${end.getMonth() + 1}月` : `${end.getFullYear()}年${end.getMonth() + 1}月`
  return `${startText}〜${endText}`
}

function hasMarkInRange(item: CalendarInstruction, startIso: string, endIso: string) {
  const hit = (iso: string | null | undefined) => Boolean(iso && iso >= startIso && iso <= endIso)
  if (hit(item.occurredOn) || hit(item.completedOn) || hit(item.dueOn)) return true
  return item.shops.some((shop) => shop.startedOns.some((day) => hit(day)))
}

function dateMarks(item: CalendarInstruction, iso: string, today: string): Mark[] {
  const marks: Mark[] = []
  if (item.occurredOn === iso) marks.push({ kind: '発生日', className: 'bg-sky-200 text-sky-950', title: `発生日 ${iso}` })
  if (item.completedOn === iso) marks.push({ kind: '完了日', className: 'bg-emerald-300 text-emerald-950', title: `完了日 ${iso}` })
  if (item.dueOn === iso) {
    const overdue = !item.completedOn && iso < today
    marks.push({
      kind: '期限',
      className: overdue ? 'bg-rose-600 text-white' : 'bg-rose-200 text-rose-950',
      title: overdue ? `期限 ${iso}（超過）` : `期限 ${iso}`,
    })
  }
  return marks
}

export default function WorkInstructionCalendar({
  items,
  onOpen,
}: {
  items: CalendarInstruction[]
  onOpen: (item: CalendarInstruction) => void
}) {
  const today = todayIso()
  const [cursor, setCursor] = useState(() => monthStart(new Date()))
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const startIso = isoFromParts(year, month, 1)
  const endDate = new Date(year, month + SPAN_MONTHS, 0)
  const endIso = isoFromParts(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())

  const days = useMemo(() => {
    const list: Array<{ iso: string; day: number; dow: number; monthStart: boolean }> = []
    const cursorDate = new Date(year, month, 1)
    const last = new Date(year, month + SPAN_MONTHS, 0)
    while (cursorDate <= last) {
      list.push({
        iso: isoFromParts(cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate()),
        day: cursorDate.getDate(),
        dow: cursorDate.getDay(),
        monthStart: cursorDate.getDate() === 1 && list.length > 0,
      })
      cursorDate.setDate(cursorDate.getDate() + 1)
    }
    return list
  }, [month, year])

  const monthBands = useMemo(() => {
    const bands: Array<{ key: string; label: string; days: number }> = []
    for (const day of days) {
      const key = day.iso.slice(0, 7)
      const last = bands[bands.length - 1]
      if (!last || last.key !== key) {
        const [bandYear, bandMonth] = key.split('-').map(Number)
        bands.push({ key, label: `${bandYear}年${bandMonth}月`, days: 1 })
      } else {
        last.days += 1
      }
    }
    return bands
  }, [days])

  const monthItems = useMemo(() => items.filter((item) => hasMarkInRange(item, startIso, endIso)), [endIso, items, startIso])
  const undated = useMemo(
    () => items.filter((item) => !item.dueOn && item.dueText).sort((a, b) => a.label.localeCompare(b.label, 'ja')),
    [items]
  )

  const { scrollerRef, start, end } = useBlockSlice(monthItems.length, `${startIso}:${items.length}:${items[0]?.id ?? ''}:${items.at(-1)?.id ?? ''}`)
  const shown = monthItems.slice(start, end)
  const width = LABEL_W + days.length * DAY_W

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursor(new Date(year, month - SPAN_MONTHS, 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            前の3か月
          </button>
          <button type="button" onClick={() => setCursor(monthStart(new Date()))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            今月
          </button>
          <button type="button" onClick={() => setCursor(new Date(year, month + SPAN_MONTHS, 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            次の3か月
          </button>
          <h2 className="ml-2 text-lg font-bold">{rangeLabel(cursor, SPAN_MONTHS)}</h2>
          <span className="text-sm text-slate-500">この期間 {monthItems.length} 件</span>
        </div>
        <p className="text-xs text-slate-500">着手日は、着手にした日が記録されている工程だけマスに出します。日付がない着手は工程名を黄色にしています。</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Legend className="bg-sky-200 text-sky-950" label="発生日" />
          <Legend className="bg-amber-300 text-amber-950" label="着手日" />
          <Legend className="bg-emerald-300 text-emerald-950" label="完了日" />
          <Legend className="bg-rose-200 text-rose-950" label="期限" />
        </div>
      </div>

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto rounded-xl bg-white shadow-sm">
        {monthItems.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">この3か月に発生日・着手日・完了日・期限のある指図書はありません。前の3か月・次の3か月で移動できます。</p>
        ) : (
          <div style={{ width }}>
            <div className="sticky top-0 z-30 flex border-b border-slate-300 bg-slate-100">
              <div className="sticky left-0 z-40 flex shrink-0 border-r border-slate-300 bg-slate-100">
                <HeaderCell width={NO_W}>指令番号</HeaderCell>
                <HeaderCell width={NAME_W}>名称</HeaderCell>
                <HeaderCell width={SHOP_W}>工程</HeaderCell>
              </div>
              <div>
                <div className="flex" style={{ height: MONTH_H }}>
                  {monthBands.map((band) => (
                    <div
                      key={band.key}
                      className="flex shrink-0 items-center border-r border-slate-300 px-2 text-[11px] font-semibold text-slate-700"
                      style={{ width: band.days * DAY_W }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
                <div className="flex" style={{ height: DAY_H }}>
                  {days.map((day) => (
                    <div
                      key={day.iso}
                      className={`flex shrink-0 flex-col items-center justify-center border-r border-slate-200 text-[11px] leading-tight ${
                        day.dow === 0 ? 'text-rose-600' : day.dow === 6 ? 'text-sky-700' : 'text-slate-600'
                      } ${day.iso === today ? 'bg-rose-50' : ''} ${day.monthStart ? 'shadow-[inset_2px_0_0_0_#64748b]' : ''}`}
                      style={{ width: DAY_W, height: DAY_H }}
                    >
                      <span>{WEEKDAYS[day.dow]}</span>
                      <span className={day.iso === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white' : 'font-semibold'}>
                        {day.day}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {start > 0 ? <div style={{ height: start * BLOCK_H }} /> : null}

            {shown.map((item, index) => (
              <InstructionBand
                key={item.id}
                item={item}
                days={days}
                today={today}
                stripe={(start + index) % 2 === 1}
                onOpen={onOpen}
              />
            ))}

            {end < monthItems.length ? <div style={{ height: (monthItems.length - end) * BLOCK_H }} /> : null}
          </div>
        )}
      </div>

      {undated.length > 0 ? (
        <div className="max-h-28 shrink-0 overflow-auto rounded-xl bg-white px-3 py-2 shadow-sm">
          <p className="mb-1 text-sm font-semibold">期限が日付になっていないもの {undated.length} 件</p>
          <div className="flex flex-wrap gap-2">
            {undated.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-100"
              >
                <span className="font-semibold">{item.label || item.name || '名称なし'}</span>
                {item.name ? <span className="ml-1">{item.name}</span> : null}
                <span className="ml-1 text-slate-500">{item.dueText}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InstructionBand({
  item,
  days,
  today,
  stripe,
  onOpen,
}: {
  item: CalendarInstruction
  days: Array<{ iso: string; day: number; dow: number; monthStart: boolean }>
  today: string
  stripe: boolean
  onOpen: (item: CalendarInstruction) => void
}) {
  const labelBg = stripe ? 'bg-slate-50' : 'bg-white'
  return (
    <div className="flex shadow-[inset_0_2px_0_0_#cbd5e1]" style={{ height: BLOCK_H }}>
      <div className={`sticky left-0 z-10 flex shrink-0 border-r border-slate-300 ${labelBg}`}>
        <div className="flex items-start border-r border-slate-200 px-1.5 py-1" style={{ width: NO_W }}>
          <button type="button" onClick={() => onOpen(item)} className="truncate text-left text-[12px] font-semibold text-red-700 hover:underline" title={item.label || '一覧で開く'}>
            {item.label || '（番号なし）'}
          </button>
        </div>
        <div className="truncate border-r border-slate-200 px-1.5 py-1 text-[12px]" style={{ width: NAME_W }} title={item.name || undefined}>
          {item.name}
        </div>
        <div style={{ width: SHOP_W }}>
          <RowLabel title="発生日・完了日・期限">日付</RowLabel>
          {item.shops.map((shop) => {
            const undatedStart = shop.started && shop.startedOns.length === 0
            const title = shop.startedOns.length
              ? `${shop.name} 着手日 ${shop.startedOns.join('、')}`
              : undatedStart
                ? `${shop.name} は着手です。日付はまだ記録されていません`
                : shop.assigned
                  ? `${shop.name} 担当`
                  : shop.name
            const tone = undatedStart ? 'bg-amber-400 text-slate-950' : shop.assigned && !shop.started ? 'bg-yellow-300 text-slate-950' : ''
            return (
              <RowLabel key={shop.code} title={title} className={tone}>
                {shop.code}
              </RowLabel>
            )
          })}
        </div>
      </div>
      <div className="shrink-0">
        <DayRow days={days} today={today} marksFor={(iso) => dateMarks(item, iso, today)} />
        {item.shops.map((shop) => (
          <DayRow
            key={shop.code}
            days={days}
            today={today}
            marksFor={(iso) =>
              shop.startedOns.includes(iso)
                ? [{ kind: '着手日', className: 'bg-amber-300 text-amber-950', title: `${shop.name} 着手日 ${iso}` }]
                : []
            }
          />
        ))}
      </div>
    </div>
  )
}

function DayRow({
  days,
  today,
  marksFor,
}: {
  days: Array<{ iso: string; dow: number; monthStart: boolean }>
  today: string
  marksFor: (iso: string) => Mark[]
}) {
  return (
    <div className="flex" style={{ height: ROW_H }}>
      {days.map((day) => {
        const marks = marksFor(day.iso)
        const weekend = day.dow === 0 || day.dow === 6
        return (
          <div
            key={day.iso}
            className={`flex shrink-0 items-center justify-center overflow-hidden border-r border-b border-slate-200 ${
              day.iso === today ? 'bg-rose-50' : weekend ? 'bg-slate-50' : 'bg-white'
            } ${day.monthStart ? 'shadow-[inset_2px_0_0_0_#64748b]' : ''}`}
            style={{ width: DAY_W, height: ROW_H }}
            title={marks.map((mark) => mark.title).join(' / ')}
          >
            {marks.length > 0 ? (
              <div className="flex max-h-full flex-col items-center justify-center gap-px">
                {marks.map((mark) => (
                  <span key={mark.kind} className={`rounded px-0.5 text-[10px] font-semibold leading-none ${mark.className}`}>
                    {mark.kind}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function HeaderCell({ width, children }: { width: number; children: string }) {
  return (
    <div className="flex items-end border-r border-slate-200 px-1.5 pb-1 text-xs font-semibold text-slate-700" style={{ width, height: HEADER_H }}>
      {children}
    </div>
  )
}

function RowLabel({ title, children, className = '' }: { title: string; children: string; className?: string }) {
  return (
    <div className={`flex items-center border-b border-slate-200 px-1 text-[12px] font-medium text-slate-800 ${className}`} style={{ height: ROW_H }} title={title}>
      {children}
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return <span className={`rounded border border-black/5 px-2 py-1 font-semibold ${className}`}>{label}</span>
}

function useBlockSlice(count: number, resetKey: string) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [slice, setSlice] = useState({ start: 0, end: 12 })

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = 0
    const update = () => {
      const overscan = 3
      const start = Math.max(0, Math.floor(scroller.scrollTop / BLOCK_H) - overscan)
      const end = Math.min(count, start + Math.ceil(scroller.clientHeight / BLOCK_H) + overscan * 2)
      setSlice((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [count, resetKey])

  return { scrollerRef, start: slice.start, end: slice.end }
}
