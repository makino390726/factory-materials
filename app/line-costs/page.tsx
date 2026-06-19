"use client"
import React, { useEffect, useState } from "react"
import Link from 'next/link'

type WorkOrder = { id: string; order_no?: string; name?: string }
type Row = {
  id: string
  product_code?: string
  part_name?: string
  spec?: string
  quantity: number
  unit_price: number
  material_cost: number
  labor: number
  cost_type: "加" | "直"
  indirect_cost: number
  total: number
}

const round = (n: number) => Math.round(n)

export default function LineCostPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string>("")
  const [parts, setParts] = useState<{part_key:string; product_code?:string; part_name?:string; spec?:string; cost_price?:number}[]>([])
  const [selectedPartKey, setSelectedPartKey] = useState<string>("")
  const [rows, setRows] = useState<Row[]>([])
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [allProducts, setAllProducts] = useState<{product_code:string; name:string; cost_price?:number}[]>([])
  const [productSearchQuery, setProductSearchQuery] = useState<Record<string,string>>({})
  const [showProductListFor, setShowProductListFor] = useState<string | null>(null)
  const [partSearchQuery, setPartSearchQuery] = useState<string>('')

  useEffect(() => {
    fetch('/api/work-orders')
      .then(r => r.json())
      .then(data => setWorkOrders(data || []))
      .catch(() => setWorkOrders([]))
  }, [])

  useEffect(() => {
    fetch('/api/heater/parts-master')
      .then(r => r.json())
      .then(data => setParts(data || []))
      .catch(() => setParts([]))
  }, [])

  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(data => setAllProducts(data || []))
      .catch(() => setAllProducts([]))
  }, [])

  // 選択パーツが変わったら、明細1行目にパーツ情報と単価をセット
  useEffect(() => {
    if (!selectedPartKey) return

    const loadForSelectedPart = async () => {
      // 常に最新の parts をサーバから取得してローカル state を更新（他画面での更新を反映するため）
      let fetchedParts: any[] = []
      try {
        const res = await fetch('/api/heater/parts-master')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            fetchedParts = data
            setParts(data)
          } else {
            console.error('API response is not an array:', data)
            fetchedParts = parts
          }
        } else {
          console.error('API response not ok:', res.status, res.statusText)
          fetchedParts = parts
        }
      } catch (err) {
        console.error('failed to refresh parts from server', err)
        fetchedParts = parts
      }

      // まずローカルに保存されたL指令原価があれば復元する（保存時に localStorage に退避）
      try {
        const key = `linecost:${selectedPartKey}`
        const raw = typeof window !== 'undefined' ? localStorage.getItem(key) : null
        if (raw) {
          const items = JSON.parse(raw) as any[]
          if (Array.isArray(items) && items.length > 0) {
            const restored: Row[] = items.map(it => computeRow({
              id: String(Date.now()) + Math.random().toString(36).slice(2,6),
              product_code: it.product_code || '',
              part_name: it.part_name || '',
              spec: it.spec || '',
              quantity: Number(it.quantity || 0),
              unit_price: Number(it.unit_price || 0),
              material_cost: Number(it.material_cost || 0),
              labor: Number(it.labor || 0),
              cost_type: it.cost_type || '加',
              indirect_cost: Number(it.indirect_cost || 0),
              total: Number(it.total || 0),
            }))
            setRows(restored)
            return
          }
        }
      } catch (err) {
        console.error('local restore error', err)
      }

      // fetchedParts が空の場合は parts state からの取得を優先
      const searchIn = fetchedParts.length > 0 ? fetchedParts : parts
      const p = searchIn.find(x => x.part_key === selectedPartKey)
      
      if (!p) {
        // 選択がクリアされた場合は明細を空にする
        console.warn('Part not found for key:', selectedPartKey, 'available parts:', searchIn.length)
        setRows([])
        return
      }

      // 既存の行を残さず、選択パーツに基づく単一行で画面を置き換える
      const newRow: Row = computeRow({
        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        product_code: p.product_code || '',
        part_name: p.part_name || '',
        spec: p.spec || '',
        quantity: 0,
        unit_price: Number(p.cost_price || 0),
        material_cost: 0,
        labor: 0,
        cost_type: '加',
        indirect_cost: 0,
        total: 0,
      })
      setRows([newRow])
    }

    loadForSelectedPart()
  }, [selectedPartKey])

  useEffect(() => {
    if (rows.length === 0) addRow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const computeRow = (r: Row): Row => {
    const material = round((r.quantity || 0) * (r.unit_price || 0))
    const labor = round(r.labor || 0)
    const rate = r.cost_type === '加' ? 0.3 : 0.05
    const indirect = round((material + labor) * rate)
    const total = material + labor + indirect
    return { ...r, material_cost: material, labor, indirect_cost: indirect, total }
  }

  const addRow = () => {
    const newRow: Row = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      product_code: '',
      part_name: '',
      spec: '',
      quantity: 0,
      unit_price: 0,
      material_cost: 0,
      labor: 0,
      cost_type: '加',
      indirect_cost: 0,
      total: 0,
    }
    setRows(prev => {
      const next = [...prev, computeRow(newRow)]
      return next
    })
  }

  const updateRowField = (id: string, field: Partial<Row>) => {
    setRows(prev => prev.map(r => (r.id === id ? computeRow({ ...r, ...field }) : r)))
  }

  // 商品コードを入力したときに parts_master を優先して補完（見つからなければ products を検索）
  const applyProductByCode = async (id: string, code: string) => {
    const codeTrim = (code || '').trim()
    if (!codeTrim) {
      console.log('applyProductByCode: empty code')
      return
    }

    const codeLower = codeTrim.toLowerCase()
    console.log('=== applyProductByCode START ===', { code: codeTrim, partsCount: parts.length })

    // ========== 優先度 1: パーツマスタから検索 ==========
    let searchIn = parts.length > 0 ? parts : []
    
    // parts が空の場合はサーバ側から取得
    if (searchIn.length === 0) {
      try {
        console.log('Fetching parts from server...')
        const res = await fetch('/api/heater/parts-master')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            console.log('Fetched parts count:', data.length)
            searchIn = data
            setParts(data)
          }
        } else {
          console.error('Failed to fetch parts:', res.status, res.statusText)
        }
      } catch (err) {
        console.error('failed to fetch parts:', err)
      }
    }

    // part_key で完全一致
    console.log('Searching for part_key:', codeLower, 'in', searchIn.length, 'items')
    let partFound = searchIn.find(p => (p.part_key || '').toLowerCase() === codeLower)
    if (partFound) {
      console.log('✓ Found by part_key:', {part_key: partFound.part_key, part_name: partFound.part_name, cost_price: partFound.cost_price})
      updateRowField(id, { 
        product_code: codeTrim,
        part_name: partFound.part_name || '', 
        unit_price: Number(partFound.cost_price || 0) 
      })
      console.log('=== applyProductByCode END (found in parts) ===')
      return
    }

    // product_code で検索
    partFound = searchIn.find(p => (p.product_code || '').toLowerCase() === codeLower)
    if (partFound) {
      console.log('✓ Found by product_code:', {product_code: partFound.product_code, part_name: partFound.part_name})
      updateRowField(id, { 
        product_code: codeTrim, 
        part_name: partFound.part_name || '', 
        unit_price: Number(partFound.cost_price || 0) 
      })
      console.log('=== applyProductByCode END (found in parts) ===')
      return
    }

    console.log('Not found in parts_master, searching products_master...')

    // ========== 優先度 2: 商品マスタから検索 ==========
    let found = allProducts.find(p => (p.product_code || '').toLowerCase() === codeTrim.toLowerCase())
    if (!found) {
      try {
        console.log('Searching products API with query:', codeTrim)
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(codeTrim)}`)
        if (res.ok) {
          const data = await res.json()
          console.log('Products search result count:', (data || []).length)
          if (Array.isArray(data) && data.length > 0) {
            const exact = data.find((p: any) => String(p.product_code) === codeTrim) || data[0]
            found = { product_code: exact.product_code, name: exact.name, cost_price: exact.cost_price }

            setAllProducts(prev => {
              if (prev.find(p => p.product_code === exact.product_code)) return prev
              return [...prev, { product_code: exact.product_code, name: exact.name, cost_price: exact.cost_price }]
            })
            console.log('✓ Found in products_master:', { product_code: found.product_code, name: found.name })
          } else {
            console.log('No results from products search')
          }
        } else {
          console.error('Products search failed:', res.status, res.statusText)
        }
      } catch (err) {
        console.error('applyProductByCode server search error', err)
      }
    } else {
      console.log('✓ Found in allProducts cache:', { product_code: found.product_code, name: found.name })
    }

    if (found) {
      updateRowField(id, { product_code: found.product_code, part_name: found.name, unit_price: Number(found.cost_price || 0) })
      console.log('=== applyProductByCode END (found in products) ===')
    } else {
      console.warn('⚠ Code not found:', codeTrim)
      console.log('=== applyProductByCode END (not found) ===')
    }
  }

  const filteredProductsForRow = (id: string) => {
    const q = (productSearchQuery[id] || '').toLowerCase()
    if (!q) return allProducts.slice(0, 10)
    return allProducts.filter(p => p.name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q)).slice(0, 20)
  }

  const handleSelectProductForRow = (rowId: string, p: {product_code:string; name:string; cost_price?:number}) => {
    updateRowField(rowId, { product_code: p.product_code, part_name: p.name, unit_price: Number(p.cost_price || 0) })
    setShowProductListFor(null)
    setProductSearchQuery(prev => ({ ...prev, [rowId]: '' }))
  }

  // 単価入力で Enter 押下時に products テーブルの cost_price を更新する
  const updateProductCost = async (rowId: string) => {
    const row = rows.find(r => r.id === rowId)
    if (!row || !row.product_code) {
      alert('商品コードが設定されていません')
      return
    }

    try {
      const res = await fetch('/api/products/update-cost', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_code: row.product_code, cost_price: Number(row.unit_price) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '更新に失敗しました')
      }
      const updated = await res.json()

      // ローカルキャッシュを更新
      setAllProducts(prev => prev.map(p => p.product_code === updated.product_code ? { ...p, cost_price: updated.cost_price } : p))

      alert(`商品コード ${row.product_code} の原価を ¥${Number(row.unit_price).toLocaleString()} に更新しました`)
    } catch (e) {
      console.error('updateProductCost error', e)
      alert(e instanceof Error ? e.message : '更新に失敗しました')
    }
  }

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id))

  const selectRow = (id: string) => setSelectedRowId(id)

  const save = async () => {
    const payload: any = {
      items: rows.map(r => ({
        product_code: r.product_code,
        part_name: r.part_name,
        spec: r.spec,
        quantity: r.quantity,
        unit_price: r.unit_price,
        material_cost: r.material_cost,
        labor: r.labor,
        cost_type: r.cost_type,
        indirect_cost: r.indirect_cost,
        total: r.total,
      })),
    }
    if (selectedWorkOrderId) payload.work_order_id = selectedWorkOrderId

    try {
      const res = await fetch('/api/work-order-costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('save failed')
      alert('保存しました')
      // 選択パーツがあれば、パーツマスタの原価欄を合計金額で更新する
      if (selectedPartKey) {
        try {
          const partUpdate = await fetch('/api/heater/parts-master', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ part_key: selectedPartKey, cost_price: Number(grandTotal) }),
          })
          if (!partUpdate.ok) throw new Error('parts master update failed')
          const updated = await partUpdate.json()
          // ローカルキャッシュ更新
          setParts(prev => prev.map(p => p.part_key === selectedPartKey ? { ...p, cost_price: Number(grandTotal) } : p))
          console.debug('parts master updated', updated)
        } catch (err) {
          console.error('パーツマスタ更新エラー:', err)
          alert('パーツマスタの原価更新に失敗しました')
        }
        // 保存成功時に明細をクリアして、localStorage に保存内容を退避
        try {
          const key = `linecost:${selectedPartKey}`
          localStorage.setItem(key, JSON.stringify(payload.items || []))
        } catch (err) {
          console.error('localStorage save error', err)
        }
        setRows([])

        // サーバ上の最新の parts を再取得して UI に反映（他画面で保存された変更を即時に反映する）
        try {
          const refreshed = await fetch('/api/heater/parts-master')
          if (refreshed.ok) {
            const data = await refreshed.json()
            if (Array.isArray(data)) {
              setParts(data)
              // 選択パーツの cost_price を再取得して表示を更新
              const updated = data.find((pp: any) => pp.part_key === selectedPartKey)
              if (updated) {
                // 更新された金額を表示領域（右上SELECTED）に反映するため、無害な state トリガー
                setSelectedPartKey('')
                setTimeout(() => setSelectedPartKey(updated.part_key), 10)
              }
            }
          }
        } catch (err) {
          console.error('refresh parts after save failed', err)
        }
      }
    } catch (e) {
      alert('保存に失敗しました')
    }
  }

  const grandTotal = rows.reduce((s, r) => s + (r.total || 0), 0)
  const normalizedPartQuery = partSearchQuery.trim().toLowerCase()
  const filteredParts = normalizedPartQuery
    ? parts.filter(p => {
        const name = (p.part_name || '').toLowerCase()
        const code = (p.product_code || '').toLowerCase()
        const key = (p.part_key || '').toLowerCase()
        return name.includes(normalizedPartQuery) || code.includes(normalizedPartQuery) || key.includes(normalizedPartQuery)
      }).sort((a, b) => (a.part_key || '').localeCompare(b.part_key || ''))
    : parts.slice().sort((a, b) => (a.part_key || '').localeCompare(b.part_key || ''))

  return (
    <div className="p-8 min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-slate-900 text-white">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold text-white mb-2">L指令原価計算書</h1>
            <p className="text-sm text-zinc-300">L指令作業の、材料費、工賃、間接費を主受けするイメージ画面</p>
        </div>
        <div>
          <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700">
            ← ホーム
          </Link>
        </div>
      </header>

      <div className="mb-6">
        <label className="block text-sm text-zinc-300 mb-2">パーツマスタ選択</label>
        <input
          value={partSearchQuery}
          onChange={e => setPartSearchQuery(e.target.value)}
          className="w-full max-w-2xl p-2 mb-2 bg-slate-800 text-white rounded"
          placeholder="パーツ名/商品コード/パーツキーで検索"
        />
        <select
          value={selectedPartKey}
          onChange={e => setSelectedPartKey(e.target.value)}
          className="w-full max-w-2xl p-2 bg-slate-800 text-white rounded"
        >
          <option value="">パーツを選択してください</option>
          {filteredParts.map(p => (
            <option key={p.part_key} value={p.part_key}>{p.part_name} ({p.product_code || p.part_key})</option>
          ))}
        </select>
      </div>

      <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 rounded-2xl border border-slate-700">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-12">
            <div className="overflow-x-auto bg-slate-900 rounded p-4">
              <table className="w-full table-auto text-sm text-left">
                <thead>
                  <tr className="text-cyan-200 bg-slate-800 sticky top-0 z-10">
                    <th className="px-3 py-2 text-left">商品コード</th>
                    <th className="px-3 py-2 text-left">部品名</th>
                    <th className="px-3 py-2 text-left">規格</th>
                    <th className="px-3 py-2 text-right">数量</th>
                    <th className="px-3 py-2 text-right">単価</th>
                    <th className="px-3 py-2 text-right">材料費</th>
                    <th className="px-3 py-2 text-right">工賃</th>
                    <th className="px-3 py-2 text-center">区分</th>
                    <th className="px-3 py-2 text-right">間接費</th>
                    <th className="px-3 py-2 text-right">合計</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className={
                      "border-t border-slate-700 cursor-pointer " +
                      (r.id === selectedRowId ? 'ring-2 ring-cyan-500 ' : '') +
                      (idx === 0 ? 'bg-rose-900 text-rose-50' : 'bg-transparent')
                    } onClick={() => selectRow(r.id)}>
                      <td className="p-2">
                        <input className={"w-40 p-1 rounded " + (idx === 0 ? 'bg-rose-800 font-semibold text-rose-50 border-b-2 border-rose-600' : 'bg-slate-800 text-white')} value={r.product_code}
                          onChange={e => {
                            console.log('商品コード field onChange:', e.target.value)
                            updateRowField(r.id, { product_code: e.target.value })
                          }}
                          onBlur={(e) => {
                            console.log('商品コード field onBlur:', e.currentTarget.value)
                            applyProductByCode(r.id, (e.currentTarget.value || ''))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              console.log('商品コード field Enter:', (e.currentTarget as HTMLInputElement).value)
                              applyProductByCode(r.id, (e.currentTarget as HTMLInputElement).value || '')
                            }
                          }}
                        />
                      </td>
                      <td className="p-2 relative">
                        <input className={"w-64 p-1 rounded " + (idx === 0 ? 'bg-rose-800 font-semibold text-rose-50 border-b-2 border-rose-600' : 'bg-slate-800 text-white')} value={r.part_name}
                          onChange={e => { setProductSearchQuery(prev => ({ ...prev, [r.id]: e.target.value })); updateRowField(r.id, { part_name: e.target.value }) }}
                          onFocus={() => setShowProductListFor(r.id)}
                          onBlur={() => setTimeout(() => setShowProductListFor(null), 150)}
                        />
                        {showProductListFor === r.id && (
                          <div className="absolute left-0 mt-1 bg-white text-black rounded shadow max-h-48 overflow-auto z-20 w-80">
                            {filteredProductsForRow(r.id).map(p => (
                              <div key={p.product_code} className="px-3 py-2 hover:bg-slate-100 cursor-pointer" onMouseDown={(ev) => { ev.preventDefault(); handleSelectProductForRow(r.id, { product_code: p.product_code, name: p.name, cost_price: p.cost_price }) }}>
                                <div className="font-medium">{p.name}</div>
                                <div className="text-xs text-slate-500">{p.product_code} {p.cost_price ? `¥${p.cost_price}` : ''}</div>
                              </div>
                            ))}
                            {filteredProductsForRow(r.id).length === 0 && <div className="px-3 py-2 text-sm text-slate-500">該当なし</div>}
                          </div>
                        )}
                      </td>
                      <td className="p-2"><input className={"w-40 p-1 rounded " + (idx === 0 ? 'bg-rose-800 font-semibold text-rose-50 border-b-2 border-rose-600' : 'bg-slate-800 text-white')} value={r.spec}
                        onChange={e => updateRowField(r.id, { spec: e.target.value })}
                      /></td>
                      <td className="p-2 text-right"><input type="number" step="any" className={"w-20 p-1 text-right rounded " + (idx === 0 ? 'bg-rose-800 font-semibold text-rose-50' : 'bg-slate-800 text-white')}
                        value={r.quantity} onChange={e => updateRowField(r.id, { quantity: Number(e.target.value) })}
                      /></td>
                      <td className="p-2 text-right"><input type="number" step="any" className={"w-24 p-1 text-right rounded " + (idx === 0 ? 'bg-rose-800 font-semibold text-rose-50' : 'bg-slate-800 text-white')}
                        value={r.unit_price} onChange={e => updateRowField(r.id, { unit_price: Number(e.target.value) })}
                        onKeyDown={(e) => { if (e.key === 'Enter') updateProductCost(r.id) }}
                        title="Enterで製品マスタの原価を更新"
                      /></td>
                      <td className="p-2 text-right">{r.material_cost.toLocaleString()}</td>
                      <td className="p-2"><input type="number" step="any" className="w-20 p-1 bg-slate-800 text-white rounded text-right"
                        value={r.labor} onChange={e => updateRowField(r.id, { labor: Number(e.target.value) })}
                      /></td>
                      <td className="p-2">
                        <select className="bg-slate-800 text-white p-1 rounded" value={r.cost_type}
                          onChange={e => updateRowField(r.id, { cost_type: e.target.value as any })}
                        >
                          <option value="加">加</option>
                          <option value="直">直</option>
                        </select>
                      </td>
                      <td className="p-2 text-right">{r.indirect_cost.toLocaleString()}</td>
                      <td className="p-2 font-bold text-right">{r.total.toLocaleString()}</td>
                      <td className="p-2"><button className="text-sm text-red-400 px-2" onClick={() => removeRow(r.id)}>削除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex items-center gap-3">
                <button className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-full shadow-lg" onClick={save}>保存</button>
                <button className="bg-rose-500 hover:bg-rose-400 text-white px-4 py-2 rounded-full shadow" onClick={addRow}>+ 部品行を追加</button>
              </div>

              <div className="mt-6">
                <div className="rounded-xl border border-cyan-600 p-6 bg-gradient-to-r from-cyan-800 to-cyan-600 text-white w-3/4">
                  <div className="text-lg text-cyan-100">原価合計額</div>
                  <div className="text-3xl font-extrabold mt-2">¥{grandTotal.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 選択行概要を削除: テーブル幅を拡張して操作を内包 */}
        </div>
      </div>
    </div>
  )
}
