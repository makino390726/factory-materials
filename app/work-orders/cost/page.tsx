'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import Link from 'next/link'
import { getMonthMinutes, type MonthlyDurationRow } from '@/lib/work-report-aggregation'

type WorkOrderOption = {
  id: string
  order_no: string
  product_name: string | null
  model: string | null
  qty: number | null
  standard_duration_minutes: number | null
  status: string | null
  cost_mode?: 'direct' | 'bom' | null
  bom_model?: string | null
}

type BranchOption = {
  id: string
  branch_no: string
  part_key: string
  part_name: string | null
}

type Product = {
  id: string
  product_code: string
  name: string
  cost_price: number | null
}

type LineMaster = {
  id: string
  line_code: string
  standard_duration_minutes: number | null
  part_key?: string | null
  part_assignments?: Array<{
    part_key: string
    ratio?: number
  }>
}

type PartRow = {
  id: string
  product_code: string
  part_name: string
  spec: string
  quantity: string
  unit_price: string
  material_cost: string
  labor_cost: string
  indirect_cost: string
  cost_type: string
}

const createPartRow = (): PartRow => ({
  id: crypto.randomUUID(),
  product_code: '',
  part_name: '',
  spec: '',
  quantity: '',
  unit_price: '',
  material_cost: '0',
  labor_cost: '0',
  indirect_cost: '0',
  cost_type: '加',
})

const toNumber = (value: string | number | null | undefined) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (value === null || value === undefined) {
    return 0
  }

  // Accept values like "1,234" or full-width digits "１２３４".
  const normalized = String(value)
    .trim()
    .replace(/[，,\s]/g, '')
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const buildLineOrderNo = (partKey: string, suffix?: string) => {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `LINE-${partKey}-${suffix ?? timestamp}`
}

const formatBranchNo = (branchNo: string): string => {
  const stripped = String(branchNo || '').replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  if (!stripped) return String(branchNo || '')
  return String(parseInt(stripped, 10)).padStart(2, '0')
}

const buildOrderBranchMasterId = (orderNo: string, branchNo: string): string => {
  const normalizedOrderNo = String(orderNo || '').trim()
  const normalizedBranchNo = formatBranchNo(branchNo)
  return normalizedOrderNo && normalizedBranchNo ? `${normalizedOrderNo}-${normalizedBranchNo}` : normalizedOrderNo
}

const buildOrderBranchMasterIdLegacy = (orderNo: string, branchNo: string): string => {
  const normalizedOrderNo = String(orderNo || '').trim()
  const stripped = String(branchNo || '').replace(/^[A-Za-z]+/, '').replace(/^0+/, '')
  const legacyBranchNo = stripped || String(branchNo || '').trim()
  return normalizedOrderNo && legacyBranchNo ? `${normalizedOrderNo}-${legacyBranchNo}` : normalizedOrderNo
}

export default function WorkOrderCostPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([])
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [laborCost, setLaborCost] = useState('0')
  const [laborIndirectCost, setLaborIndirectCost] = useState('0')
  const [laborCostType, setLaborCostType] = useState<'加' | '直'>('加')
  const [partRows, setPartRows] = useState<PartRow[]>([createPartRow()])
  const [sortColumn, setSortColumn] = useState<string>('order_no')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [searchingRowId, setSearchingRowId] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<{[key: string]: Product[]}>({})
  const [isSearching, setIsSearching] = useState(false)
  const timersRef = useRef<Record<string, number>>({})
  const [mode, setMode] = useState<'order' | 'line'>('order')
  const [partsMaster, setPartsMaster] = useState<Product[]>([])
  const [lineMasters, setLineMasters] = useState<LineMaster[]>([])
  const [selectedPartKey, setSelectedPartKey] = useState('')
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importStage, setImportStage] = useState('待機中')
  const [isBulkUpdatingUnitPrice, setIsBulkUpdatingUnitPrice] = useState(false)
  const [monthlyLineMinutes, setMonthlyLineMinutes] = useState<Record<string, number>>({})
  const [monthlyOrderMinutes, setMonthlyOrderMinutes] = useState<number | null>(null)
  const [plannedPartQty, setPlannedPartQty] = useState<number | null>(null)
  const [plannedPartQtyMeta, setPlannedPartQtyMeta] = useState<{
    plan_fiscal_year: string | null
    total_plan_qty: number
    model_count: number
  } | null>(null)

  useEffect(() => {
    const loadMonthlyLineMinutes = async () => {
      try {
        const res = await fetch('/api/work-reports/aggregations/monthly?category=line&all=1')
        if (!res.ok) return
        const data = (await res.json()) as Record<string, MonthlyDurationRow[]>
        const map: Record<string, number> = {}
        for (const [lineCode, rows] of Object.entries(data)) {
          map[lineCode] = getMonthMinutes(rows)
        }
        setMonthlyLineMinutes(map)
      } catch (err) {
        console.error('月別ライン実績の取得エラー:', err)
      }
    }
    loadMonthlyLineMinutes()
  }, [])

  useEffect(() => {
    const fetchWorkOrders = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/work-orders')
        if (!response.ok) throw new Error('作業指令の取得に失敗しました')
        const data = await response.json()
        setWorkOrders(data || [])
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    fetchWorkOrders()
  }, [])

  // 選択パーツが変わったら localStorage から復元、なければ partsMaster から1行セット
  useEffect(() => {
    const restore = async () => {
      if (!selectedPartKey) {
        console.debug('no selectedPartKey, resetting to empty row')
        setPartRows([createPartRow()])
        return
      }

      console.debug('restore: loading for selectedPartKey=', selectedPartKey)

      // refresh parts from server to get latest
      let fetched: any[] = []
      try {
        const res = await fetch('/api/heater/parts-master')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            fetched = data
            setPartsMaster(data.map((p: any, i: number) => ({ id: p.part_key || p.id || p.product_code || `pm-${i}`, product_code: p.product_code || '', name: p.part_name || p.name || '', cost_price: p.cost_price || 0 })))
          }
        }
      } catch (err) {
        console.error('parts refresh error', err)
      }

      try {
        console.debug('fetching items from DB for part_key:', selectedPartKey)
        const res = await fetch(`/api/work-order-costs/items-by-part-key?part_key=${encodeURIComponent(selectedPartKey)}`)
        if (!res.ok) {
          const errText = await res.text()
          console.error(`fetch items failed: ${res.status} ${res.statusText}`, errText)
          throw new Error(`fetch items failed (${res.status}): ${errText}`)
        }
        const items = await res.json() as any[]
        console.debug('fetched items count:', items.length)
        
        if (Array.isArray(items) && items.length > 0) {
          const restored = items.map((it: any) => ({
            id: it.id || crypto.randomUUID(),
            product_code: it.product_code || '',
            part_name: it.part_name || '',
            spec: it.spec || '',
            quantity: String(it.quantity || 0),
            unit_price: String(it.unit_price || 0),
            material_cost: String(it.material_cost || 0),
            labor_cost: String(it.labor_cost || 0),
            indirect_cost: String(it.indirect_cost || 0),
            cost_type: it.cost_type || '加',
          }))
          console.debug('restored rows:', restored.length)
          setPartRows(restored)
          return
        }
      } catch (err) {
        console.error('DB restore error', err)
      }

      const partsList = fetched.length > 0 ? fetched : partsMaster
      const p = partsList.find((pp: any) => (pp.part_key || pp.id) === selectedPartKey || String(pp.id) === String(selectedPartKey))
      if (!p) {
        setPartRows([createPartRow()])
        return
      }
      setPartRows([{
        id: crypto.randomUUID(),
        product_code: p.product_code || '',
        part_name: p.part_name || p.name || '',
        spec: p.spec || '',
        quantity: '0',
        unit_price: String(p.cost_price || 0),
        material_cost: '0',
        labor_cost: '0',
        indirect_cost: '0',
        cost_type: '加',
      }])
    }
    restore()
  }, [selectedPartKey])

  // ラインモードの場合は parts master を取得してクライアント側検索に使う
  useEffect(() => {
    if (mode !== 'line') return
    const load = async () => {
      try {
        const res = await fetch('/api/heater/parts-master')
        if (!res.ok) return
        const data = await res.json()
        // transform to Product-compatible shape
        const mapped = (data || []).map((p: any, i: number) => ({
          id: p.part_key || p.id || p.product_code || `pm-${i}`,
          product_code: p.part_key || p.product_code || '',
          name: p.part_name || p.name || '',
          cost_price: p.cost_price || 0
        }))
        console.debug('Loaded partsMaster for line mode:', mapped.length, 'items')
        setPartsMaster(mapped)
      } catch (err) {
        console.error('parts master load error', err)
      }
    }
    load()
    // clear selected work order when switching to line mode
    setSelectedWorkOrderId('')
  }, [mode])

  // ラインモードで所要時間を参照するため、ラインマスタを取得
  useEffect(() => {
    if (mode !== 'line') return

    const loadLines = async () => {
      try {
        const res = await fetch('/api/lines')
        if (!res.ok) return
        const data = await res.json()
        setLineMasters(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('line master load error', err)
      }
    }

    loadLines()
  }, [mode])

  // 追加: ページ読み込み時に parts master を先読みしておく（ライン切替の遅延対策）
  useEffect(() => {
    const preload = async () => {
      try {
        const res = await fetch('/api/heater/parts-master')
        if (!res.ok) return
        const data = await res.json()
        const mapped = (data || []).map((p: any, i: number) => ({
          id: p.part_key || p.id || p.product_code || `pm-${i}`,
          product_code: p.part_key || p.product_code || '',
          name: p.part_name || p.name || '',
          cost_price: p.cost_price || 0
        }))
        setPartsMaster(mapped)
      } catch (err) {
        console.error('parts master preload error', err)
      }
    }
    preload()
  }, [])

  // デバウンス用のタイマー
  useEffect(() => {
    const timers: {[key: string]: NodeJS.Timeout} = {}
    
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  const searchProducts = async (rowId: string, query: string) => {
    console.debug('searchProducts called', { mode, query })
    if (!query) {
      setSearchResults((prev) => ({ ...prev, [rowId]: [] }))
      return
    }
    const qtrim = query.trim()
    const isCodeLike = /^[A-Za-z0-9]+$/.test(qtrim)
    if (qtrim.length < 2 && !isCodeLike) {
      setSearchResults((prev) => ({ ...prev, [rowId]: [] }))
      return
    }

    setIsSearching(true)
    try {
      let results: Product[] = []
      
      // ========== 優先度 1: パーツマスタから検索 ==========
      const qtrimLower = qtrim.toLowerCase()
      if (partsMaster.length > 0) {
        console.debug('Searching in partsMaster...')
        // product_code と name (part_name) で検索
        const partResults = partsMaster.filter(p =>
          (p.product_code || '').toLowerCase().includes(qtrimLower) ||
          (p.name || '').toLowerCase().includes(qtrimLower)
        )
        if (partResults.length > 0) {
          console.log('Found in partsMaster:', partResults.length, 'items')
          results = partResults
        }
      }

      // パーツマスタで見つからなければ商品マスタから検索
      if (results.length === 0) {
        console.debug('Searching in products table...')
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(qtrim)}`)
        if (!response.ok) throw new Error('検索に失敗しました')
        const data = await response.json()
        console.log('検索結果:', Array.isArray(data) ? data.length : '非配列応答', '件')
        if (Array.isArray(data)) console.debug('検索結果サンプル:', data.slice(0,5))
        results = data || []
      }

      setSearchResults((prev) => ({ ...prev, [rowId]: results }))
    } catch (error) {
      console.error('検索エラー:', error)
      setSearchResults((prev) => ({ ...prev, [rowId]: [] }))
    } finally {
      setIsSearching(false)
    }
  }

  const selectedOrder = useMemo(
    () => workOrders.find((order) => order.id === selectedWorkOrderId) || null,
    [workOrders, selectedWorkOrderId]
  )

  useEffect(() => {
    const orderNo = selectedOrder?.order_no
    if (mode !== 'order' || !orderNo) {
      setMonthlyOrderMinutes(null)
      return
    }

    const loadMonthlyOrderMinutes = async () => {
      try {
        const res = await fetch(
          `/api/work-reports/aggregations/monthly?category=instruction&code=${encodeURIComponent(orderNo)}`
        )
        if (!res.ok) {
          setMonthlyOrderMinutes(null)
          return
        }
        const rows = (await res.json()) as MonthlyDurationRow[]
        setMonthlyOrderMinutes(getMonthMinutes(rows))
      } catch (err) {
        console.error('月別指令実績の取得エラー:', err)
        setMonthlyOrderMinutes(null)
      }
    }
    loadMonthlyOrderMinutes()
  }, [mode, selectedOrder?.order_no])

  const selectedPart = useMemo(() => partsMaster.find(p => p.id === selectedPartKey) || null, [partsMaster, selectedPartKey])
  const selectedBranch = useMemo(
    () => branchOptions.find((branch) => branch.id === selectedBranchId) || null,
    [branchOptions, selectedBranchId]
  )

  const loadCostDepsKey = [
    selectedWorkOrderId,
    selectedBranchId,
    mode,
    selectedOrder?.cost_mode || '',
    selectedOrder?.order_no || '',
    selectedBranch?.part_key || '',
    selectedBranch?.branch_no || '',
  ].join('|')

  const matchingLines = useMemo(() => {
    if (!selectedPartKey) return [] as LineMaster[]
    return lineMasters.filter(
      (line) =>
        line.part_key === selectedPartKey ||
        (line.part_assignments || []).some((a) => a.part_key === selectedPartKey)
    )
  }, [lineMasters, selectedPartKey])

  useEffect(() => {
    if (mode !== 'line' || !selectedPartKey) {
      setPlannedPartQty(null)
      setPlannedPartQtyMeta(null)
      return
    }

    const loadPlannedQty = async () => {
      try {
        const res = await fetch(
          `/api/heater/manufacturing-plans/planned-part-qty?part_key=${encodeURIComponent(selectedPartKey)}`
        )
        if (!res.ok) {
          setPlannedPartQty(null)
          setPlannedPartQtyMeta(null)
          return
        }
        const data = await res.json()
        const qty = Number(data?.planned_part_qty || 0)
        setPlannedPartQty(qty > 0 ? qty : null)
        setPlannedPartQtyMeta({
          plan_fiscal_year: data?.plan_fiscal_year ?? null,
          total_plan_qty: Number(data?.total_plan_qty || 0),
          model_count: Number(data?.model_count || 0),
        })
      } catch (err) {
        console.error('製造計画台数の取得エラー:', err)
        setPlannedPartQty(null)
        setPlannedPartQtyMeta(null)
      }
    }

    loadPlannedQty()
  }, [mode, selectedPartKey])

  const aggregatedMonthlyLineDurationMinutes = useMemo(() => {
    return matchingLines.reduce(
      (sum, line) => sum + (monthlyLineMinutes[line.line_code] ?? 0),
      0
    )
  }, [matchingLines, monthlyLineMinutes])

  const aggregatedStandardLineDurationMinutes = useMemo(() => {
    return matchingLines.reduce(
      (sum, line) => sum + Number(line.standard_duration_minutes || 0),
      0
    )
  }, [matchingLines])

  /** ラインの制作所要時間（標準所要時間を優先、なければ月次実績） */
  const totalProductionDurationMinutes = useMemo(() => {
    if (aggregatedStandardLineDurationMinutes > 0) {
      return aggregatedStandardLineDurationMinutes
    }
    return aggregatedMonthlyLineDurationMinutes
  }, [aggregatedMonthlyLineDurationMinutes, aggregatedStandardLineDurationMinutes])

  /** 1個あたり制作時間 = 制作所要時間 ÷ 製造計画部品数 */
  const perUnitDurationMinutes = useMemo(() => {
    if (mode !== 'line' || !selectedPartKey) return null
    if (totalProductionDurationMinutes <= 0) return null
    if (!plannedPartQty || plannedPartQty <= 0) return null
    return Math.round((totalProductionDurationMinutes / plannedPartQty) * 10) / 10
  }, [mode, selectedPartKey, totalProductionDurationMinutes, plannedPartQty])

  const effectiveDurationMinutes = mode === 'line'
    ? (selectedPartKey ? (perUnitDurationMinutes ?? totalProductionDurationMinutes ?? null) : null)
    : (monthlyOrderMinutes ?? selectedOrder?.standard_duration_minutes ?? null)

  useEffect(() => {
    const loadBranches = async () => {
      if (mode !== 'order' || !selectedWorkOrderId) {
        setBranchOptions([])
        setSelectedBranchId('')
        return
      }

      try {
        const res = await fetch(`/api/work-orders/branches?work_order_id=${encodeURIComponent(selectedWorkOrderId)}`)
        if (!res.ok) {
          setBranchOptions([])
          setSelectedBranchId('')
          return
        }
        const data = await res.json()
        const mapped: BranchOption[] = (data.branches || []).map((branch: any) => ({
          id: String(branch.id || ''),
          branch_no: String(branch.branch_no || ''),
          part_key: String(branch.part_key || ''),
          part_name: branch.part_name || null,
        }))
        setBranchOptions(mapped)
        setSelectedBranchId((prev) => {
          if (prev && mapped.some((branch) => branch.id === prev)) return prev
          return mapped[0]?.id || ''
        })
      } catch (err) {
        console.error('failed to load branches', err)
        setBranchOptions([])
        setSelectedBranchId('')
      }
    }

    loadBranches()
  }, [mode, selectedWorkOrderId, workOrders])

  const isOrderCompleted = selectedOrder?.status === '完了'
  const isAutoLaborMode = mode === 'line' || isOrderCompleted

  const UNIT_LABOR_COST = 17810 // 1工数単価
  const UNIT_MINUTES = 480 // 8時間=480分
  const LABOR_UNIT_PRICE = 170 // 工賃単価計算用

  // 工賃単価：170 ÷ 480、少数第4位四捨五入
  const calculateLaborUnitPrice = (): number => {
    const calculated = LABOR_UNIT_PRICE / UNIT_MINUTES
    // 少数第4位四捨五入
    return Math.round(calculated * 1000) / 1000
  }

  // 工賃の自動計算：(所要時間 ÷ 480) × 17,810、小数第1位四捨五入
  const calculateAutoLaborCost = (): number => {
    if (effectiveDurationMinutes === null || effectiveDurationMinutes === 0) {
      return 0
    }
    // 所要時間 ÷ 480（8時間） = 工数単位
    // 工数単位 × 17810（1日工賃） = 工賃
    const calculated = (effectiveDurationMinutes / UNIT_MINUTES) * UNIT_LABOR_COST
    // 小数第1位四捨五入で整数
    return Math.round(calculated)
  }

  useEffect(() => {
    if (isAutoLaborMode) {
      setLaborCost(String(calculateAutoLaborCost()))
    }
  }, [isAutoLaborMode, effectiveDurationMinutes])

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedOrders = () => {
    if (!sortColumn) return workOrders

    const sorted = [...workOrders].sort((a, b) => {
      const aVal = (a as any)[sortColumn]
      const bVal = (b as any)[sortColumn]

      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal, 'ja-JP')
          : bVal.localeCompare(aVal, 'ja-JP')
      }

      if (typeof aVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      return 0
    })

    return sorted
  }

  const handlePartChange = (id: string, key: keyof PartRow, value: string) => {
    setPartRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row

        const updated = { ...row, [key]: value }

        // 再計算ルール:
        // - 材料費 = round(数量 × 単価)
        // - 間接費 = round((材料費 + 工賃) × (区分に応じた率))
        const pct = updated.cost_type === '加' ? 0.3 : 0.05

        // cost_type の変更時は現在の材料費/工賃合計で間接費を再計算
        if (key === 'cost_type') {
          const materialNum = toNumber(String(updated.material_cost))
          const laborNum = toNumber(String(updated.labor_cost))
          const indirect = Math.round((materialNum + laborNum) * (value === '加' ? 0.3 : 0.05))
          return { ...updated, indirect_cost: String(indirect) }
        }

        // 数量または単価が変更された場合: 材料費を再計算し、間接費も再計算
        if (key === 'quantity' || key === 'unit_price') {
          const qty = key === 'quantity' ? value : updated.quantity
          const unitPrice = key === 'unit_price' ? value : updated.unit_price
          const qtyNum = toNumber(String(qty))
          const priceNum = toNumber(String(unitPrice))
          if (!Number.isFinite(qtyNum) || !Number.isFinite(priceNum)) {
            return updated
          }
          const material = Math.round(qtyNum * priceNum)
          const laborNum = toNumber(String(updated.labor_cost))
          const indirect = Math.round((material + laborNum) * pct)
          return { ...updated, material_cost: String(material), indirect_cost: String(indirect) }
        }

        // 工賃や材料費が直接編集された場合: 間接費を再計算
        if (key === 'labor_cost' || key === 'material_cost') {
          const materialNum = toNumber(String(updated.material_cost))
          const laborNum = toNumber(String(updated.labor_cost))
          const indirect = Math.round((materialNum + laborNum) * pct)
          return { ...updated, indirect_cost: String(indirect) }
        }

        return updated
      })
    )
  }

  const handleSelectProduct = (rowId: string, product: Product) => {
    setPartRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              product_code: product.product_code || product.id,
              part_name: product.name,
              unit_price: String(product.cost_price || 0),
              // recalc material & indirect when unit_price set from master
              material_cost: String(Math.round(toNumber(row.quantity) * toNumber(String(product.cost_price || 0)))),
              indirect_cost: String(Math.round((Math.round(toNumber(row.quantity) * toNumber(String(product.cost_price || 0))) + toNumber(row.labor_cost)) * (row.cost_type === '加' ? 0.3 : 0.05))),
            }
          : row
      )
    )
    setSearchingRowId(null)
  }

  // 商品コードでマスターを検索して行にセットする
  const fetchProductByCode = async (rowId: string, code: string) => {
    if (!code || code.trim().length === 0) return
    
    const codeTrim = code.trim()
    const codeLower = codeTrim.toLowerCase()
    console.log('fetchProductByCode called with:', { rowId, code: codeTrim })
    
    try {
      // ========== 優先度 1: パーツマスタを参照 ==========
      let partMatch: any | null = null
      if (Array.isArray(partsMaster) && partsMaster.length > 0) {
        console.log('Searching in partsMaster, count:', partsMaster.length)
        // product_code で完全一致
        partMatch = partsMaster.find(p => (p.product_code || '').toLowerCase() === codeLower)
        // id で一致（part_key）
        if (!partMatch) {
          partMatch = partsMaster.find(p => (p.id || '').toLowerCase() === codeLower)
        }
        // 名前で検索
        if (!partMatch) {
          partMatch = partsMaster.find(p => (p.name || '').toLowerCase().includes(codeLower))
        }
        console.log('partMatch result:', partMatch ? { id: partMatch.id, name: partMatch.name } : 'not found')
      } else {
        console.log('partsMaster is empty, loading from server...')
        // partsMaster が空の場合はサーバから取得
        try {
          const res = await fetch('/api/heater/parts-master')
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data)) {
              const mapped = data.map((p: any, i: number) => ({
                id: p.part_key || p.id || p.product_code || `pm-${i}`,
                product_code: p.product_code || '',
                name: p.part_name || p.name || '',
                cost_price: p.cost_price || 0,
              }))
              setPartsMaster(mapped)
              // 再検索
              partMatch = mapped.find(p => (p.product_code || '').toLowerCase() === codeLower)
              if (!partMatch) {
                partMatch = mapped.find(p => (p.id || '').toLowerCase() === codeLower)
              }
              if (!partMatch) {
                partMatch = mapped.find(p => (p.name || '').toLowerCase().includes(codeLower))
              }
              console.log('After fetch, partMatch:', partMatch ? { id: partMatch.id, name: partMatch.name } : 'not found')
            }
          }
        } catch (err) {
          console.error('Failed to fetch partsMaster', err)
        }
      }

      if (partMatch) {
        console.log('✓ Found in partsMaster:', { id: partMatch.id, name: partMatch.name, cost_price: partMatch.cost_price })

        const isPartKeyInput = String(partMatch.id || '').toLowerCase() === codeLower

        if (isPartKeyInput) {
          try {
            const summaryRes = await fetch(`/api/work-order-costs/items-summary?part_key=${encodeURIComponent(String(partMatch.id))}`)
            const summaryData = summaryRes.ok ? await summaryRes.json() : []
            const summary = Array.isArray(summaryData) ? summaryData[0] : null
            const materialTotal = summary ? Number(summary.material_cost_total || 0) : 0
            const indirectTotal = summary ? Number(summary.indirect_cost_total || 0) : 0

            setPartRows((prev) =>
              prev.map((row) => {
                if (row.id !== rowId) return row
                return {
                  ...row,
                  product_code: codeTrim,
                  part_name: partMatch.name || '',
                  unit_price: '',
                  material_cost: String(materialTotal),
                  indirect_cost: String(indirectTotal),
                }
              })
            )
            return
          } catch (err) {
            console.error('part_key summary fetch error', err)
          }
        }

        setPartRows((prev) =>
          prev.map((row) => {
            if (row.id !== rowId) return row
            const qtyNum = toNumber(row.quantity)
            const priceNum = Number(partMatch.cost_price || 0)
            const material = Math.round(qtyNum * priceNum)
            const indirect = Math.round((material + toNumber(row.labor_cost)) * (row.cost_type === '加' ? 0.3 : 0.05))
            return {
              ...row,
              product_code: codeTrim,
              part_name: partMatch.name || '',
              unit_price: String(partMatch.cost_price || 0),
              material_cost: String(material),
              indirect_cost: String(indirect),
            }
          })
        )
        return
      }

      // ========== 優先度 2: 商品マスタから検索 ==========
      console.log('Not found in partsMaster, searching in products...')
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(codeTrim)}`)
      if (!res.ok) {
        console.log('Products search returned status:', res.status)
        return
      }
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) {
        console.log('No results from products search')
        return
      }

      console.log('✓ Found in products:', data.length, 'results')
      // 完全一致を優先して探す
      const exact = data.find((p: any) => String(p.product_code) === String(codeTrim)) || data[0]

      setPartRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row
          const qtyNum = toNumber(row.quantity)
          const priceNum = Number(exact.cost_price || 0)
          const material = Math.round(qtyNum * priceNum)
          const indirect = Math.round((material + toNumber(row.labor_cost)) * (row.cost_type === '加' ? 0.3 : 0.05))
          return {
            ...row,
            product_code: exact.product_code,
            part_name: exact.name,
            unit_price: String(exact.cost_price || 0),
            material_cost: String(material),
            indirect_cost: String(indirect),
          }
        })
      )
    } catch (err) {
      console.error('fetchProductByCode error', err)
    }
  }

    // 工賃（ヘッダ）の間接費を laborCostType と laborCost に応じて自動再計算
    useEffect(() => {
      const laborVal = isOrderCompleted ? calculateAutoLaborCost() : toNumber(laborCost)
      const pct = laborCostType === '加' ? 0.3 : 0.05
      const indirect = Math.round(laborVal * pct)
      setLaborIndirectCost(String(indirect))
    }, [laborCost, laborCostType, selectedWorkOrderId, isOrderCompleted])

  const handleUpdateCostPrice = async (rowId: string) => {
    const row = partRows.find((r) => r.id === rowId)
    if (!row || !row.product_code || !row.unit_price) {
      return
    }
    const productCodeRaw = (row.product_code || '')
    const productCode = productCodeRaw.trim()
    if (!productCode) {
      alert('商品コードが設定されていません')
      return
    }

    console.debug('handleUpdateCostPrice', { rowId, productCode, unit_price: row.unit_price })

    try {
      const response = await fetch('/api/products/update-cost', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: productCode,
          cost_price: Number(row.unit_price),
        }),
      })

      if (!response.ok) {
        let errorText = '更新に失敗しました'
        let status = response.status
        try {
          const errorData = await response.json()
          errorText = errorData.error || errorText
        } catch (e) {
          const text = await response.text().catch(() => '')
          if (text) errorText = text
        }

        // 製品が見つからない場合は新規登録を試みる仕様
        if (status === 404 || /見つかりません/.test(errorText)) {
          try {
            const createRes = await fetch('/api/products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ product_code: productCode, name: row.part_name || productCode, cost_price: Number(row.unit_price) }),
            })
            if (!createRes.ok) {
              let createErr = '製品の作成に失敗しました'
              try {
                const ce = await createRes.json()
                createErr = ce.error || createErr
              } catch (ee) {
                const t = await createRes.text().catch(() => '')
                if (t) createErr = t
              }
              throw new Error(createErr)
            }

            const created = await createRes.json()
            // 作成された製品の原価を反映
            setPartRows(prev => prev.map(r => r.id === rowId ? { ...r, product_code: created.product_code || productCode, unit_price: String(created.cost_price || Number(row.unit_price)) } : r))
            // partsMaster キャッシュにも反映
            setPartsMaster(prev => {
              if (prev.find(p => p.product_code === created.product_code)) return prev
              return [...prev, { id: created.id || created.product_code, product_code: created.product_code, name: created.name, cost_price: created.cost_price || Number(row.unit_price) }]
            })

            alert(`商品 ${created.product_code} を新規登録して原価を ¥${Number(row.unit_price).toLocaleString()} に設定しました`)
            return
          } catch (createErr) {
            console.error('create product error', createErr)
            alert(createErr instanceof Error ? createErr.message : '製品作成に失敗しました')
            return
          }
        }

        throw new Error(errorText)
      }

      const result = await response.json()
      console.log('原価更新成功:', result)
      alert(`商品コード ${row.product_code} の原価を ¥${Number(row.unit_price).toLocaleString()} に更新しました`)
    } catch (error) {
      console.error('原価更新エラー:', error)
      alert(error instanceof Error ? error.message : '原価更新に失敗しました')
    }
  }

  const handleBulkApplyProductCostPrice = async () => {
    if (partRows.length === 0) {
      alert('更新対象の行がありません')
      return
    }

    const codes = Array.from(
      new Set(
        partRows
          .map((row) => String(row.product_code || '').trim())
          .filter((code) => code.length > 0)
      )
    )

    if (codes.length === 0) {
      alert('商品コードが入力されている行がありません')
      return
    }

    setIsBulkUpdatingUnitPrice(true)

    try {
      const res = await fetch('/api/products/by-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '製品単価の取得に失敗しました')
      }

      const result = await res.json()
      const items = Array.isArray(result.items) ? result.items : []
      const productMap = new Map<string, number | null>()
      for (const item of items) {
        productMap.set(String(item.product_code || '').trim(), item.cost_price ?? null)
      }

      let updatedCount = 0
      let skippedNoProductCount = 0
      let skippedNoCostCount = 0
      let unchangedCount = 0

      const updatedRows = partRows.map((row) => {
        const productCode = String(row.product_code || '').trim()
        if (!productCode) {
          unchangedCount += 1
          return row
        }

        if (!productMap.has(productCode)) {
          skippedNoProductCount += 1
          return row
        }

        const productCostPrice = productMap.get(productCode)
        const normalizedProductCost =
          productCostPrice === null || productCostPrice === undefined ? null : Number(productCostPrice)

        // products.cost_price が null/0/非数値の場合は既存値を維持
        if (
          normalizedProductCost === null ||
          !Number.isFinite(normalizedProductCost) ||
          normalizedProductCost === 0
        ) {
          skippedNoCostCount += 1
          return row
        }

        const currentUnitPrice = toNumber(row.unit_price)
        if (Math.abs(currentUnitPrice - normalizedProductCost) < 1e-9) {
          unchangedCount += 1
          return row
        }

        const material = Math.round(toNumber(row.quantity) * normalizedProductCost)
        const indirect = Math.round(
          (material + toNumber(row.labor_cost)) * (row.cost_type === '加' ? 0.3 : 0.05)
        )

        updatedCount += 1
        return {
          ...row,
          unit_price: String(normalizedProductCost),
          material_cost: String(material),
          indirect_cost: String(indirect),
        }
      })

      setPartRows(updatedRows)

      alert(
        `一括更新が完了しました\n` +
        `更新: ${updatedCount}件\n` +
        `未変更: ${unchangedCount}件\n` +
        `スキップ(products未登録): ${skippedNoProductCount}件\n` +
        `スキップ(products.cost_price が 0/null): ${skippedNoCostCount}件`
      )
    } catch (error) {
      console.error('bulk apply product cost error:', error)
      alert(error instanceof Error ? error.message : '一括更新に失敗しました')
    } finally {
      setIsBulkUpdatingUnitPrice(false)
    }
  }

  const handlePartNameInput = (rowId: string, value: string) => {
    console.log('入力:', value)
    handlePartChange(rowId, 'part_name', value)
    setSearchingRowId(rowId)

    // デバウンス: 前のタイマーをクリアしてから 300ms 後に検索
    const prev = timersRef.current[rowId]
    if (prev) clearTimeout(prev)
    const timerId = window.setTimeout(() => {
      searchProducts(rowId, value)
      delete timersRef.current[rowId]
    }, 300)
    timersRef.current[rowId] = timerId
  }

  const getFilteredProducts = (rowId: string) => {
    const results = searchResults[rowId] || []
    console.log('表示する検索結果:', results.length, '件')
    return results
  }

  const handleAddPartRow = () => {
    setPartRows((prev) => [...prev, createPartRow()])
  }

  const handleDeleteRow = (rowId: string) => {
    if (partRows.length <= 1) {
      alert('最低1行は必要です')
      return
    }
    if (confirm('この行を削除しますか？')) {
      setPartRows((prev) => prev.filter((r) => r.id !== rowId))
    }
  }

  // 選択した指令（work_order_id）に既存の原価データがあればロードする
  useEffect(() => {
    const load = async () => {
      if (!selectedWorkOrderId) return
      try {
        const res = await fetch(`/api/work-order-costs?work_order_id=${encodeURIComponent(selectedWorkOrderId)}`)
        if (!res.ok) return
        const data = await res.json()
        const isBranchScopedOrder = mode === 'order' && Boolean(selectedBranch)
        const branchCompositeKey = selectedOrder && selectedBranch
          ? buildOrderBranchMasterId(selectedOrder.order_no, selectedBranch.branch_no)
          : ''
        const rawBranchCompositeKey = selectedOrder && selectedBranch
          ? `${selectedOrder.order_no}-${selectedBranch.branch_no}`
          : ''

        const branchLegacyCompositeKey = selectedOrder && selectedBranch
          ? buildOrderBranchMasterIdLegacy(selectedOrder.order_no, selectedBranch.branch_no)
          : ''

        let branchKeyCandidates = [
          branchCompositeKey,
          branchLegacyCompositeKey,
          selectedBranch?.part_key || '',
          rawBranchCompositeKey,
        ]
          .map((v) => String(v || '').trim())
          .filter((v, idx, arr) => v.length > 0 && arr.indexOf(v) === idx)

        let directBranchItems: any[] = []
        if (isBranchScopedOrder && branchKeyCandidates.length > 0) {
          const directRes = await fetch(
            `/api/work-order-costs/items-by-master?master_id=${encodeURIComponent(branchKeyCandidates.join(','))}`
          )
          if (directRes.ok) {
            const rows = await directRes.json()
            if (Array.isArray(rows)) {
              const grouped = new Map<string, any[]>()
              for (const it of rows) {
                const key = String(it.master_id || '').trim()
                const list = grouped.get(key) ?? []
                list.push(it)
                grouped.set(key, list)
              }

              for (const key of branchKeyCandidates) {
                const matched = grouped.get(key)
                if (matched && matched.length > 0) {
                  const orderTypeItems = matched.filter((it: any) => String(it.master_type || '').trim() === '指令原価')
                  directBranchItems = orderTypeItems.length > 0 ? orderTypeItems : matched
                  break
                }
              }
            }
          }
        }

        if (data.found || directBranchItems.length > 0) {
          const filteredSourceItems = (() => {
            if (isBranchScopedOrder) {
              if (directBranchItems.length > 0) return directBranchItems
              const groupedByMasterId = new Map<string, any[]>()
              for (const it of (data.items || [])) {
                const key = String(it.master_id || '').trim()
                const list = groupedByMasterId.get(key) ?? []
                list.push(it)
                groupedByMasterId.set(key, list)
              }
              for (const key of branchKeyCandidates) {
                const matched = groupedByMasterId.get(key)
                if (matched && matched.length > 0) return matched
              }
              return []
            }
            return data.items || []
          })()

          // header/itemsを画面にセット
          const items = filteredSourceItems.map((it: any) => ({
            id: it.id || crypto.randomUUID(),
            product_code: it.product_code || '',
            part_name: it.part_name || '',
            spec: it.spec || '',
            quantity: String(it.quantity || 0),
            unit_price: String(it.unit_price || 0),
            material_cost: String(it.material_cost || 0),
            labor_cost: String(it.labor_cost || 0),
            indirect_cost: String(it.indirect_cost || 0),
            cost_type: it.cost_type || '加',
          }))

          setPartRows(items.length > 0 ? items : [createPartRow()])

          // BOM時は枝番で絞った行から工賃系を復元、通常はヘッダ合計を使用
          if (isBranchScopedOrder && selectedBranch) {
            const laborFromItems = filteredSourceItems.reduce((sum: number, it: any) => sum + Number(it.labor_cost || 0), 0)
            const indirectFromItems = filteredSourceItems.reduce((sum: number, it: any) => sum + Number(it.indirect_cost || 0), 0)
            setLaborCost(String(laborFromItems))
            setLaborIndirectCost(String(indirectFromItems))
          } else if (data.header) {
            setLaborIndirectCost(String(data.header.total_indirect_cost || 0))
            setLaborCost(String(data.header.total_labor_cost || 0))
            if (data.header.labor_cost_type) {
              setLaborCostType(data.header.labor_cost_type)
            }
          }
        } else {
          // 新規: 自動計算（工賃）を反映
          setPartRows([createPartRow()])
          setLaborIndirectCost('0')
          setLaborCost(String(calculateAutoLaborCost()))
          setLaborCostType('加')
        }
      } catch (error) {
        console.error('load cost error:', error)
      }
    }

    load()
  }, [loadCostDepsKey])

  // 保存処理: 存在すればPUT、なければPOST
  const handleSave = async () => {
    if (mode === 'order') {
      if (!selectedWorkOrderId) {
        alert('指令を選択してください')
        return
      }
    } else {
      // line モードではパーツ選択が必須
      if (!selectedPartKey) {
        alert('パーツを選択してください')
        return
      }
    }

    const effectiveLaborCost = headerLaborCost

    const headerPayload = {
      total_material_cost: partRows.reduce((s, r) => s + toNumber(r.material_cost), 0),
      total_labor_cost: effectiveLaborCost,
      total_indirect_cost: toNumber(laborIndirectCost),
      total_cost:
        effectiveLaborCost + toNumber(laborIndirectCost) + partRows.reduce((s, r) => s + toNumber(r.material_cost) + toNumber(r.labor_cost) + toNumber(r.indirect_cost), 0),
    }

    const itemPartKey = mode === 'line' ? selectedPartKey : ''
    const orderMasterId = selectedBranch
      ? buildOrderBranchMasterId(selectedOrder?.order_no || '', selectedBranch.branch_no)
      : (selectedOrder?.order_no || '')
    const itemsPayload = partRows.map((r, idx) => ({
      line_no: idx + 1,
      product_code: r.product_code,
      part_name: r.part_name,
      spec: r.spec,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      material_cost: Number(r.material_cost),
      labor_cost: Number(r.labor_cost),
      indirect_cost: Number(r.indirect_cost),
      cost_type: r.cost_type || '加',
      line_total: Number(r.material_cost) + Number(r.labor_cost) + Number(r.indirect_cost),
      master_type: mode === 'order' ? '指令原価' : 'ライン原価',
      master_id: mode === 'order' ? orderMasterId : itemPartKey,
    }))

    const saveLineCostToDb = async (orderNo: string) => {
      // 既存データを削除（master_type='ライン原価' and master_id=selectedPartKey）
      try {
        const deleteRes = await fetch(`/api/work-order-costs/items-by-master?master_type=${encodeURIComponent('ライン原価')}&master_id=${encodeURIComponent(selectedPartKey)}`, {
          method: 'DELETE'
        })
        console.debug('delete existing line items:', deleteRes.status)
      } catch (err) {
        console.warn('delete existing items failed (may not exist)', err)
      }

      // 新規登録
      const res = await fetch('/api/work-order-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_no: orderNo, work_order_id: null, header: headerPayload, items: itemsPayload }),
      })
      const text = await res.text()
      console.debug('work-order-costs POST (line)', res.status, text)
      if (!res.ok) throw new Error('line cost save failed')
    }

    try {
      if (mode === 'line' && !selectedWorkOrderId) {
        // ラインモードで指令未選択: work-order-costs へは保存せず、parts master の更新のみ行う
        try {
          const orderNo = buildLineOrderNo(selectedPartKey)
          await saveLineCostToDb(orderNo)
          const partRes = await fetch('/api/heater/parts-master', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ part_key: selectedPartKey, cost_price: Math.round(headerPayload.total_cost) }),
          })
          const partBody = await partRes.text()
          console.debug('parts master update response', partRes.status, partBody)
          if (!partRes.ok) {
            alert('パーツマスタ更新に失敗しました')
            return
          }
          // 保存成功時に localStorage に退避、明細をクリア
          try {
            const key = `linecost:${selectedPartKey}`
            const itemsPayload = partRows.map(r => ({ product_code: r.product_code, part_name: r.part_name, spec: r.spec, quantity: r.quantity, unit_price: r.unit_price, material_cost: r.material_cost, labor: r.labor_cost, indirect_cost: r.indirect_cost, total: calculateRowTotal(r as any), cost_type: r.cost_type || '加', master_type: 'ライン原価', master_id: selectedPartKey }))
            localStorage.setItem(key, JSON.stringify(itemsPayload || []))
          } catch (err) {
            console.error('localStorage save error', err)
          }
          setPartRows([createPartRow()])
          alert('保存しました')
          // parts を再取得して UI を更新
          try {
            const refreshed = await fetch('/api/heater/parts-master')
            if (refreshed.ok) {
              const data = await refreshed.json()
              if (Array.isArray(data)) {
                const mapped = data.map((p: any, i: number) => ({ id: p.part_key || p.id || p.product_code || `pm-${i}`, product_code: p.product_code || '', name: p.part_name || p.name || '', cost_price: p.cost_price || 0 }))
                setPartsMaster(mapped)
                const updated = mapped.find((pp: any) => pp.id === selectedPartKey || String(pp.id) === String(selectedPartKey))
                if (updated) {
                  setSelectedPartKey('')
                  setTimeout(() => setSelectedPartKey(updated.id), 10)
                }
              }
            }
          } catch (err) {
            console.error('refresh parts after save failed', err)
          }
        } catch (err) {
          console.error('parts master update error:', err)
          alert('保存に失敗しました')
        }
      } else {
        // 既存の挙動: work-order-costs に保存
        // 既存確認 by work_order_id
        const checkRes = await fetch(`/api/work-order-costs?work_order_id=${encodeURIComponent(selectedWorkOrderId)}`)
        const checkJson = await checkRes.json()

        if (checkJson.found) {
          // 更新
          const res = await fetch('/api/work-order-costs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_order_id: selectedWorkOrderId, header: headerPayload, items: itemsPayload }),
          })
          const text = await res.text()
          console.debug('work-order-costs PUT', res.status, text)
          if (res.ok) {
            alert('更新しました')
          } else {
            alert('更新に失敗しました')
          }
        } else {
          // 新規登録
          const res = await fetch('/api/work-order-costs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_no: selectedOrder?.order_no, work_order_id: selectedWorkOrderId, header: headerPayload, items: itemsPayload }),
          })
          const text = await res.text()
          console.debug('work-order-costs POST', res.status, text)
          if (res.ok) {
            alert('登録しました')
          } else {
            alert('登録に失敗しました')
          }
        }
      }
      // ラインモードなら、パーツマスタの原価欄を更新する
      if (mode === 'line' && selectedPartKey) {
        try {
          const partRes = await fetch('/api/heater/parts-master', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ part_key: selectedPartKey, cost_price: Math.round(headerPayload.total_cost) }),
          })
          if (!partRes.ok) throw new Error('parts master update failed')
          const updated = await partRes.json()
          // 更新した値をローカルにも反映
          setPartsMaster(prev => prev.map(p => p.id === selectedPartKey || p.id === String(selectedPartKey) ? { ...p, cost_price: Math.round(headerPayload.total_cost) } : p))
          // 保存成功時に localStorage に退避、明細をクリア
          try {
            const key = `linecost:${selectedPartKey}`
            localStorage.setItem(key, JSON.stringify(itemsPayload || []))
          } catch (err) {
            console.error('localStorage save error', err)
          }
          setPartRows([createPartRow()])
          console.debug('parts master updated from work-order save', updated)
          // parts を再取得して UI を更新
          try {
            const refreshed = await fetch('/api/heater/parts-master')
            if (refreshed.ok) {
              const data = await refreshed.json()
              if (Array.isArray(data)) {
                const mapped = data.map((p: any, i: number) => ({ id: p.part_key || p.id || p.product_code || `pm-${i}`, product_code: p.product_code || '', name: p.part_name || p.name || '', cost_price: p.cost_price || 0 }))
                setPartsMaster(mapped)
                const updated = mapped.find((pp: any) => pp.id === selectedPartKey || String(pp.id) === String(selectedPartKey))
                if (updated) {
                  setSelectedPartKey('')
                  setTimeout(() => setSelectedPartKey(updated.id), 10)
                }
              }
            }
          } catch (err) {
            console.error('refresh parts after save failed', err)
          }
        } catch (err) {
          console.error('parts master update error', err)
          alert('パーツマスタの更新に失敗しました')
        }
      }
    } catch (error) {
      console.error('save error:', error)
      alert('保存処理でエラーが発生しました')
    }
  }

  const handleMigrateLineLocalStorage = async () => {
    if (!confirm('ローカル保存のライン明細をDBに移行します。よろしいですか？')) return

    const keys = Object.keys(localStorage).filter(key => key.startsWith('linecost:'))
    if (keys.length === 0) {
      alert('移行対象のローカル明細がありません')
      return
    }

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      const partKey = key.replace('linecost:', '')
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw ? JSON.parse(raw) : []
        if (!Array.isArray(parsed) || parsed.length === 0) continue

        const itemsPayload = parsed.map((item: any, idx: number) => ({
          line_no: idx + 1,
          product_code: item.product_code ?? '',
          part_name: item.part_name ?? '',
          spec: item.spec ?? '',
          quantity: toNumber(String(item.quantity ?? 0)),
          unit_price: toNumber(String(item.unit_price ?? 0)),
          material_cost: toNumber(String(item.material_cost ?? 0)),
          labor_cost: toNumber(String(item.labor_cost ?? item.labor ?? 0)),
          indirect_cost: toNumber(String(item.indirect_cost ?? 0)),
          line_total: toNumber(String(item.total ?? item.line_total ?? 0)),
          cost_type: item.cost_type ?? '加',
          master_type: 'ライン原価',
          master_id: partKey || null,
        }))

        const headerPayload = {
          total_material_cost: itemsPayload.reduce((s, r) => s + Number(r.material_cost || 0), 0),
          total_labor_cost: itemsPayload.reduce((s, r) => s + Number(r.labor_cost || 0), 0),
          total_indirect_cost: itemsPayload.reduce((s, r) => s + Number(r.indirect_cost || 0), 0),
          total_cost: itemsPayload.reduce((s, r) => s + Number(r.material_cost || 0) + Number(r.labor_cost || 0) + Number(r.indirect_cost || 0), 0),
        }

        const orderNo = buildLineOrderNo(partKey, `IMPORT-${Date.now()}-${i + 1}`)
        const res = await fetch('/api/work-order-costs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_no: orderNo, work_order_id: null, header: headerPayload, items: itemsPayload }),
        })

        if (!res.ok) throw new Error('migrate failed')

        localStorage.removeItem(key)
        successCount += 1
      } catch (err) {
        console.error('linecost migrate error', key, err)
        failCount += 1
      }
    }

    alert(`移行完了: 成功 ${successCount} 件 / 失敗 ${failCount} 件`)
  }

  const handleImportCostItems = async () => {
    if (!importFile) {
      alert('CSV/Excelファイルを選択してください')
      return
    }

    if (!confirm('work_order_cost_items に取り込みます。master_id が既存のデータは更新（置換）されます。実行しますか？')) {
      return
    }

    try {
      setIsImporting(true)
      setImportProgress(0)
      setImportStage('アップロード中')
      const formData = new FormData()
      formData.append('file', importFile)

      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/work-order-costs/import')

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
          setImportProgress(percent)
          if (percent >= 100) {
            setImportStage('サーバー処理中')
          }
        }

        xhr.onload = () => {
          const responseBody = xhr.responseText ? JSON.parse(xhr.responseText) : {}
          if (xhr.status >= 200 && xhr.status < 300) {
            setImportStage('反映中')
            setImportProgress(100)
            resolve(responseBody)
            return
          }
          reject(new Error(responseBody?.error || `インポートに失敗しました (${xhr.status})`))
        }

        xhr.onerror = () => {
          reject(new Error('ネットワークエラーでインポートに失敗しました'))
        }

        xhr.send(formData)
      })

      if (!result?.success) {
        throw new Error(result?.error || 'インポートに失敗しました')
      }

      const summary = result?.summary
      const unmatchedIds: string[] = Array.isArray(summary?.unmatchedMasterIds) ? summary.unmatchedMasterIds : []
      const unmatchedDetails: Array<{ master_id: string; near_part_keys?: string[] }> = Array.isArray(summary?.unmatchedDetails)
        ? summary.unmatchedDetails
        : []
      const unmatchedPreview = unmatchedDetails
        .slice(0, 10)
        .map((d) => `  ${d.master_id}${Array.isArray(d.near_part_keys) && d.near_part_keys.length > 0 ? ` -> 近似: ${d.near_part_keys.join(', ')}` : ''}`)
        .join('\n')
      alert(
        `インポート完了\n` +
        `- 読込行数: ${summary?.totalRows ?? 0}\n` +
        `- 取込行数: ${summary?.importedRows ?? 0}\n` +
        `- 更新master_id: ${summary?.updatedMasters ?? 0}\n` +
        `- 新規master_id: ${summary?.insertedMasters ?? 0}\n` +
        `- パーツリスト更新件数: ${summary?.partsUpdated ?? 0}\n` +
        `- 未一致master_id件数: ${unmatchedIds.length}` +
        (unmatchedIds.length > 0 ? `\n- 未一致master_id: ${unmatchedIds.slice(0, 20).join(', ')}` : '') +
        (unmatchedPreview ? `\n- 未一致詳細(先頭10件):\n${unmatchedPreview}` : '')
      )

      // インポート後に最新データを再取得して画面表示へ反映
      try {
        const refreshed = await fetch('/api/heater/parts-master')
        if (refreshed.ok) {
          const data = await refreshed.json()
          if (Array.isArray(data)) {
            const mapped = data.map((p: any, i: number) => ({
              id: p.part_key || p.id || p.product_code || `pm-${i}`,
              product_code: p.part_key || p.product_code || '',
              name: p.part_name || p.name || '',
              cost_price: p.cost_price || 0,
            }))
            setPartsMaster(mapped)
          }
        }

        if (mode === 'line' && selectedPartKey) {
          const itemRes = await fetch(`/api/work-order-costs/items-by-part-key?part_key=${encodeURIComponent(selectedPartKey)}`)
          if (itemRes.ok) {
            const items = await itemRes.json()
            if (Array.isArray(items) && items.length > 0) {
              const restored = items.map((it: any) => ({
                id: it.id || crypto.randomUUID(),
                product_code: it.product_code || '',
                part_name: it.part_name || '',
                spec: it.spec || '',
                quantity: String(it.quantity || 0),
                unit_price: String(it.unit_price || 0),
                material_cost: String(it.material_cost || 0),
                labor_cost: String(it.labor_cost || 0),
                indirect_cost: String(it.indirect_cost || 0),
                cost_type: it.cost_type || '加',
              }))
              setPartRows(restored)
            }
          }
        }
      } catch (refreshErr) {
        console.error('import refresh error:', refreshErr)
      }

      setImportFile(null)
    } catch (err) {
      console.error('cost items import error:', err)
      alert(err instanceof Error ? err.message : 'インポートに失敗しました')
    } finally {
      setImportStage('待機中')
      setIsImporting(false)
    }
  }

  const calculateRowTotal = (row: PartRow) => {
    return toNumber(row.material_cost) + toNumber(row.labor_cost) + toNumber(row.indirect_cost)
  }

  const headerLaborCost = isAutoLaborMode ? calculateAutoLaborCost() : toNumber(laborCost)
  const partMaterialTotal = partRows.reduce((sum, row) => sum + toNumber(row.material_cost), 0)
  const partLaborTotal = partRows.reduce((sum, row) => sum + toNumber(row.labor_cost), 0)
  const partIndirectTotal = partRows.reduce((sum, row) => sum + toNumber(row.indirect_cost), 0)
  const materialTotal = partMaterialTotal
  const laborTotal = headerLaborCost + partLaborTotal
  const indirectTotal = toNumber(laborIndirectCost) + partIndirectTotal
  const grandTotal = materialTotal + laborTotal + indirectTotal

  const productionQty = mode === 'order'
    ? Math.max(1, Number(selectedOrder?.qty || 1))
    : 1

  const qtyMaterialTotal = Math.round(materialTotal * productionQty)
  const qtyLaborTotal = Math.round(laborTotal * productionQty)
  const qtyIndirectTotal = Math.round(indirectTotal * productionQty)
  const qtyGrandTotal = qtyMaterialTotal + qtyLaborTotal + qtyIndirectTotal

  
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(254,242,242,0.65),_transparent_60%),linear-gradient(180deg,#0f172a_0%,#111827_45%,#020617_100%)] p-6 sm:p-10">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <div className="flex items-center gap-4">
              <p className="text-rose-200 text-sm uppercase tracking-[0.35em]">Order Costing</p>
              <div className="ml-4 inline-flex bg-slate-800 rounded-full p-1">
                <button className={`px-3 py-1 rounded-full text-sm ${mode === 'order' ? 'bg-rose-500 text-white' : 'text-slate-300'}`} onClick={() => setMode('order')}>指令原価計算</button>
                <button className={`px-3 py-1 rounded-full text-sm ${mode === 'line' ? 'bg-cyan-500 text-white' : 'text-slate-300'}`} onClick={() => setMode('line')}>ライン原価計算</button>
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-white">
              {mode === 'order' ? '指令書原価計算' : 'ライン原価計算'}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {mode === 'order' ? '指令別の材料費・工賃・間接費を集計するイメージ画面' : 'パーツマスタを参照してライン単位の原価計算を行います'}
            </p>
          </div>
          <Link href="/">
            <button className="px-6 py-2 rounded-full border border-rose-300/50 text-rose-100 hover:border-rose-200 hover:text-white transition">
              ← ホーム
            </button>
          </Link>
        </div>

        <div className="bg-slate-900/95 rounded-3xl border-2 border-slate-700 shadow-2xl p-6 sm:p-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div>
                <label className="text-sm font-semibold text-slate-200">{mode === 'order' ? '作業指令' : 'パーツリスト選択'}</label>
                <div className="mt-2 flex gap-2">
                  {mode === 'order' ? (
                    <>
                      <select
                        value={selectedWorkOrderId}
                        onChange={(event) => setSelectedWorkOrderId(event.target.value)}
                        className="flex-1 rounded-xl border-2 border-slate-600 bg-slate-800 px-4 py-3 text-slate-100 font-medium shadow-sm focus:border-rose-400 focus:ring-2 focus:ring-rose-500/50 focus:outline-none"
                      >
                        <option value="">指令を選択してください</option>
                        {getSortedOrders().map((order) => (
                          <option key={order.id} value={order.id}>
                            {order.order_no} {order.product_name ? `- ${order.product_name}` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleSort('order_no')}
                        className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm font-medium transition border-2 border-slate-600"
                        title="指令番号でソート"
                      >
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </button>
                    </>
                  ) : (
                    <select
                      value={selectedPartKey}
                      onChange={(e) => setSelectedPartKey(e.target.value)}
                      className="flex-1 rounded-xl border-2 border-slate-600 bg-slate-800 px-4 py-3 text-slate-100 font-medium shadow-sm focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/50 focus:outline-none"
                    >
                      <option value="">パーツを選択してください</option>
                      {[...partsMaster].sort((a, b) => String(a.id || a.product_code || '').localeCompare(String(b.id || b.product_code || ''))).map((p, idx) => (
                        <option key={p.id || p.product_code || idx} value={p.id || p.product_code || ''}>{p.name} ({p.product_code || p.id})</option>
                      ))}
                    </select>
                  )}
                </div>
              {mode === 'order' && (selectedOrder?.cost_mode === 'bom' || branchOptions.length > 0) && (
                <div className="mt-3">
                  <label className="text-xs font-semibold text-violet-300">枝番</label>
                  <select
                    value={selectedBranchId}
                    onChange={(event) => setSelectedBranchId(event.target.value)}
                    className="mt-1 w-full rounded-xl border-2 border-violet-500/60 bg-slate-800 px-4 py-2 text-slate-100 text-sm shadow-sm focus:border-violet-400 focus:ring-2 focus:ring-violet-500/50 focus:outline-none"
                  >
                    {branchOptions.length === 0 ? (
                      <option value="">枝番なし</option>
                    ) : (
                      branchOptions.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {`${selectedOrder?.order_no || ''}-${branch.branch_no}-${branch.part_name || '部品名未設定'}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
              {isLoading && (
                <p className="mt-2 text-xs text-slate-400">読み込み中...</p>
              )}
              {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
            </div>
            <div className="rounded-2xl bg-slate-800/80 border-2 border-slate-600 p-4">
              <p className="text-xs text-rose-400 uppercase tracking-[0.3em]">Selected</p>
                <p className="mt-2 text-lg font-semibold text-slate-100">
                  {mode === 'order' ? (selectedOrder ? selectedOrder.order_no : '未選択') : (selectedPart ? `${selectedPart.name}` : '未選択')}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  {mode === 'order' ? (selectedOrder?.product_name || '製品名未設定') : (selectedPart ? `コード: ${selectedPart.product_code || selectedPart.id}` : 'パーツ未選択')}
                </p>
                {mode === 'order' ? (
                  <>
                    <p className="text-sm text-slate-400">型式: {selectedOrder?.model || '-'}</p>
                    <p className="text-sm text-slate-400">数量: {selectedOrder?.qty?.toLocaleString() || '-'}</p>
                    {(selectedOrder?.cost_mode === 'bom' || branchOptions.length > 0) && (
                      <p className="text-sm text-violet-300">
                        枝番: {selectedBranch ? `${selectedBranch.branch_no} / ${selectedBranch.part_name || '部品名未設定'}` : '未選択'}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-400">原価: ¥{selectedPart ? Number(selectedPart.cost_price || 0).toLocaleString() : '-'}</p>
                  </>
                )}
            </div>
          </div>

          <div className="mt-8 overflow-x-auto border-2 border-slate-700 rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="text-left bg-gradient-to-r from-slate-800 to-slate-700">
                <tr>
                  <th className="py-4 pr-4 pl-4 font-bold text-slate-200 border-b-2 border-slate-600">商品コード</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">部品名</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">規格</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">数量</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">単価</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">材料費</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">工賃</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">区分</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">間接費</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">合計</th>
                  <th className="py-4 pr-4 font-bold text-slate-200 border-b-2 border-slate-600">削除</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                <tr className="bg-rose-900/40 border-b border-rose-800/50">
                  <td className="py-4 pr-4 pl-4 text-slate-500">-</td>
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-rose-300">工賃</span>
                      {mode === 'order' && !isOrderCompleted && (
                        <span className="text-xs font-semibold text-amber-300 bg-amber-900/60 px-2 py-1 rounded">
                          ステータスが完了してません
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 pr-4 font-medium text-rose-400">固定</td>
                  <td className="py-4 pr-4 text-rose-300 font-medium">
                    <div>{effectiveDurationMinutes ?? '-'} 分</div>
                    {mode === 'line' && selectedPartKey && totalProductionDurationMinutes > 0 && (
                      <div className="mt-1 text-xs text-rose-200/80">
                        {plannedPartQty && plannedPartQty > 0 ? (
                          <>
                            制作所要 {totalProductionDurationMinutes.toLocaleString('ja-JP')}分
                            ÷ 計画 {plannedPartQty.toLocaleString('ja-JP')}個
                            {plannedPartQtyMeta?.plan_fiscal_year
                              ? `（${plannedPartQtyMeta.plan_fiscal_year}年度）`
                              : ''}
                          </>
                        ) : (
                          <span className="text-amber-300">
                            製造計画が未登録のため1個あたりに換算できません
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-4 pr-4 text-rose-300 font-medium">
                    {calculateLaborUnitPrice().toFixed(3)}
                  </td>
                  <td className="py-4 pr-4 text-slate-500">-</td>
                  <td className="py-4 pr-4">
                    <input
                      type="number"
                      min="0"
                      value={isAutoLaborMode ? calculateAutoLaborCost() : laborCost}
                      onChange={(event) => setLaborCost(event.target.value)}
                      disabled={isAutoLaborMode}
                      className={`w-24 rounded-lg border-2 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                        isAutoLaborMode
                          ? 'border-green-600 text-green-300 cursor-not-allowed'
                          : 'border-rose-600 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/50'
                      }`}
                    />
                  </td>
                  <td className="py-4 pr-4">
                    <select
                      value={laborCostType}
                      onChange={(e) => setLaborCostType(e.target.value as '加' | '直')}
                      className="w-20 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-2 py-2 font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none"
                    >
                      <option value="加">加</option>
                      <option value="直">直</option>
                    </select>
                  </td>
                  <td className="py-4 pr-4">
                    <input
                      type="number"
                      min="0"
                      value={laborIndirectCost}
                      onChange={(event) => setLaborIndirectCost(event.target.value)}
                      className="w-24 rounded-lg border-2 border-rose-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-rose-400 focus:ring-2 focus:ring-rose-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </td>
                  <td className="py-4 pr-4 font-bold text-lg text-rose-300">
                    {(headerLaborCost + toNumber(laborIndirectCost)).toLocaleString()}
                  </td>
                  <td className="py-4 pr-4 text-slate-500 text-center">-</td>
                </tr>

                {partRows.map((row) => {
                  const totalCost = calculateRowTotal(row)

                  const rowIndex = partRows.indexOf(row)
                  const isEven = rowIndex % 2 === 0

                  return (
                    <tr key={row.id} className={`border-b border-slate-700 ${isEven ? 'bg-slate-800/50' : 'bg-slate-900/30'}`}>
                      <td className="py-4 pr-4 pl-4">
                        <input
                          value={row.product_code}
                          onChange={(event) => handlePartChange(row.id, 'product_code', event.target.value)}
                          onBlur={() => fetchProductByCode(row.id, row.product_code)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              fetchProductByCode(row.id, row.product_code)
                            }
                          }}
                          className="w-32 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none"
                          placeholder="商品コード"
                        />
                      </td>
                      <td className="py-4 pr-4 relative">
                        <div className="relative">
                          <input
                            value={row.part_name}
                            onChange={(event) => handlePartNameInput(row.id, event.target.value)}
                            onFocus={() => setSearchingRowId(row.id)}
                            onBlur={() => setTimeout(() => setSearchingRowId(null), 200)}
                            className="w-48 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none"
                            placeholder="部品名を入力（2文字以上）"
                          />
                          {searchingRowId === row.id && getFilteredProducts(row.id).length > 0 && (
                            <div className="absolute z-50 mt-1 w-96 max-h-60 overflow-auto bg-slate-800 border-2 border-blue-500 rounded-lg shadow-2xl">
                              {isSearching && (
                                <div className="px-4 py-2 text-xs text-slate-400 bg-slate-700">
                                  検索中...
                                </div>
                              )}
                              {getFilteredProducts(row.id).map((product) => (
                                <div
                                  key={product.id}
                                  onClick={() => handleSelectProduct(row.id, product)}
                                  className="px-4 py-3 cursor-pointer hover:bg-blue-900/50 border-b border-slate-700 last:border-0 transition"
                                >
                                  <div className="text-sm font-bold text-slate-100">{product.name}</div>
                                  <div className="text-xs text-slate-400 mt-1">
                                      コード: <span className="text-blue-300">{product.product_code || product.id}</span> | 
                                      単価: <span className="text-emerald-300">¥{product.cost_price?.toLocaleString() || '0'}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          value={row.spec}
                          onChange={(event) => handlePartChange(row.id, 'spec', event.target.value)}
                          className="w-24 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="規格"
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={row.quantity}
                          onChange={(event) => handlePartChange(row.id, 'quantity', event.target.value)}
                          className="w-20 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          type="number"
                          min="0"
                          value={row.unit_price}
                          onChange={(event) => handlePartChange(row.id, 'unit_price', event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              handleUpdateCostPrice(row.id)
                            }
                          }}
                          className="w-24 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="単価"
                          title="ENTERキーで製品マスタの原価を更新"
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          type="number"
                          min="0"
                          value={row.material_cost}
                          onChange={(event) => handlePartChange(row.id, 'material_cost', event.target.value)}
                          className="w-24 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="材料費"
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          type="number"
                          min="0"
                          value={row.labor_cost}
                          onChange={(event) => handlePartChange(row.id, 'labor_cost', event.target.value)}
                          className="w-24 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>
                      <td className="py-4 pr-4">
                        <select
                          value={row.cost_type}
                          onChange={(e) => handlePartChange(row.id, 'cost_type', e.target.value)}
                          className="w-20 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-2 py-2 font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none"
                        >
                          <option value="加">加</option>
                          <option value="直">直</option>
                        </select>
                      </td>
                      <td className="py-4 pr-4">
                        <input
                          type="number"
                          min="0"
                          value={row.indirect_cost}
                          onChange={(event) => handlePartChange(row.id, 'indirect_cost', event.target.value)}
                          className="w-24 rounded-lg border-2 border-slate-600 bg-slate-800 text-slate-100 px-3 py-2 text-right font-medium shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </td>
                      <td className="py-4 pr-4 text-right font-bold text-lg text-cyan-300 bg-cyan-900/20">
                        {totalCost.toLocaleString()}
                      </td>
                      <td className="py-4 pr-4">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(row.id)}
                          className="px-3 py-1 rounded-lg bg-red-900/50 hover:bg-red-800 text-red-200 text-sm font-medium transition border border-red-700 hover:border-red-600"
                          title="この行を削除"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t-2 border-slate-700 pt-6">
            <div className="w-full mb-4 p-4 rounded-xl bg-gradient-to-r from-slate-800/80 to-slate-900/80 border-2 border-cyan-600/50">
              <p className="text-[28px] text-cyan-400 uppercase tracking-[0.3em] font-semibold">原価合計額</p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-cyan-700/40 bg-slate-900/60 p-3">
                  <p className="text-xs text-cyan-300 mb-2">内訳合計（単価ベース）</p>
                  <div className="grid grid-cols-[1fr_auto] gap-y-1 text-sm text-slate-200">
                    <span>材料費計</span><span>¥{materialTotal.toLocaleString()}</span>
                    <span>工賃計</span><span>¥{laborTotal.toLocaleString()}</span>
                    <span>間接費計</span><span>¥{indirectTotal.toLocaleString()}</span>
                    <span className="font-bold text-cyan-300">総合計</span><span className="font-bold text-cyan-300">¥{grandTotal.toLocaleString()}</span>
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-700/40 bg-slate-900/60 p-3">
                  <p className="text-xs text-emerald-300 mb-2">制作数量掛け（数量: {productionQty.toLocaleString()}）</p>
                  <div className="grid grid-cols-[1fr_auto] gap-y-1 text-sm text-slate-200">
                    <span>材料費計</span><span>¥{qtyMaterialTotal.toLocaleString()}</span>
                    <span>工賃計</span><span>¥{qtyLaborTotal.toLocaleString()}</span>
                    <span>間接費計</span><span>¥{qtyIndirectTotal.toLocaleString()}</span>
                    <span className="font-bold text-emerald-300">総合計</span><span className="font-bold text-emerald-300">¥{qtyGrandTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="rounded-full border-2 border-indigo-500 bg-slate-800 px-4 py-2 text-indigo-100 file:mr-3 file:rounded-full file:border-0 file:bg-indigo-600 file:px-3 file:py-1 file:font-semibold file:text-white hover:border-indigo-400"
              />
              <button
                type="button"
                onClick={handleImportCostItems}
                disabled={isImporting || !importFile}
                className="rounded-full border-2 border-indigo-500 bg-gradient-to-r from-indigo-800 to-indigo-700 px-6 py-3 font-bold text-indigo-100 hover:border-indigo-400 shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isImporting ? '取込中...' : 'CSV明細取込'}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleBulkApplyProductCostPrice}
                disabled={isBulkUpdatingUnitPrice}
                className="rounded-full border-2 border-emerald-500 bg-gradient-to-r from-emerald-800 to-emerald-700 px-6 py-3 font-bold text-emerald-100 hover:border-emerald-400 shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isBulkUpdatingUnitPrice ? '一括更新中...' : '単価を製品マスタ値に一括更新'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-full border-2 border-cyan-500 bg-gradient-to-r from-cyan-800 to-cyan-700 px-6 py-3 font-bold text-cyan-100 hover:border-cyan-400 shadow-md transition"
              >
                保存
              </button>
              {mode === 'line' && (
                <button
                  type="button"
                  onClick={handleMigrateLineLocalStorage}
                  className="rounded-full border-2 border-amber-500 bg-gradient-to-r from-amber-800 to-amber-700 px-6 py-3 font-bold text-amber-100 hover:border-amber-400 shadow-md transition"
                >
                  ローカル明細移行
                </button>
              )}
              <button
                type="button"
                onClick={handleAddPartRow}
                className="rounded-full border-2 border-rose-500 bg-gradient-to-r from-rose-900 to-red-900 px-6 py-3 font-bold text-rose-200 hover:border-rose-400 hover:from-rose-800 hover:to-red-800 shadow-md transition"
              >
                + 部品行を追加
              </button>
            </div>
            <p className="text-sm font-medium text-slate-400">
              1行目は工賃固定、2行目以降は部品を追加できます。
            </p>
            {isImporting && (
              <div className="w-full rounded-xl border border-indigo-500/60 bg-slate-900/70 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-indigo-200">
                  <span>インポート進捗: {importStage}</span>
                  <span>{importProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${Math.max(5, importProgress)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
