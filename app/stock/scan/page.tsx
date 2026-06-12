'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Html5Qrcode } from 'html5-qrcode'

interface Product {
  product_code: string
  name: string
}

interface StockInfo {
  current_stock: number
  stock_qty?: number
  location?: string
}

interface StockHistory {
  id: string
  movement: string
  qty: number
  created_at: string
  note?: string
}

interface ScannedItem {
  product_code: string
  product_name: string
  quantity: number
  current_stock: number
}

interface TodayMovement {
  id: string
  product_code: string
  product_name: string
  movement: string
  movement_label: string
  qty: number
  staff_name?: string
  created_at: string
  note?: string
}

type ScanMode = 'select' | 'single' | 'multiple'
type OperationType = 'in' | 'out' | 'count'
type PhaseType = 'mode-select' | 'setup' | 'scanning' | 'inputting' | 'result'

export default function QRScanPage() {
  // フェーズ管理
  const [scanMode, setScanMode] = useState<ScanMode>('select')
  const [phase, setPhase] = useState<PhaseType>('mode-select')

  // スキャン設定
  const [scanning, setScanning] = useState(false)
  const [scannedData, setScannedData] = useState<any>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [operationType, setOperationType] = useState<OperationType>('out')
  const [usagePurpose, setUsagePurpose] = useState('')
  const [scanFps, setScanFps] = useState(10)

  // 複数読取用
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [currentInputItem, setCurrentInputItem] = useState<ScannedItem | null>(null)

  // UI状態
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [history, setHistory] = useState<StockHistory[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // 当日履歴
  const [todayMovements, setTodayMovements] = useState<TodayMovement[]>([])
  const [showTodayHistory, setShowTodayHistory] = useState(true)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const historyRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastScannedAtRef = useRef<Map<string, number>>(new Map())

  const extractProductCode = (decodedText: string): string | null => {
    const trimmed = decodedText.trim()
    if (!trimmed) return null

    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed.code === 'string' && parsed.code.trim()) {
        return parsed.code.trim()
      }
      return trimmed
    } catch {
      return trimmed
    }
  }

  const notifyScanSuccess = (productName: string, productCode: string, isDuplicate = false) => {
    const prefix = isDuplicate ? '再読取' : '読取成功'
    setMessage({ type: 'success', text: `${prefix}: ${productName} (${productCode})` })

    // 端末が対応していれば短いバイブ
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(80)
    }

    // 短い確認音
    try {
      const audioContext = new window.AudioContext()
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(isDuplicate ? 520 : 880, audioContext.currentTime)
      gain.gain.setValueAtTime(0.001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.12)

      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start()
      oscillator.stop(audioContext.currentTime + 0.12)
    } catch {
      // ブラウザ制約で再生できない場合は無視
    }
  }

  // 当日履歴を取得
  const fetchTodayMovements = async () => {
    try {
      const res = await fetch('/api/stock/movements/today?limit=10')
      const data = await res.json()
      if (data.success) {
        setTodayMovements(data.data || [])
      }
    } catch (error) {
      console.error('当日履歴取得エラー:', error)
    }
  }

  // 複数読取モード時の新しい読取処理
  const handleMultipleScan = async (decodedText: string) => {
    try {
      const productCode = extractProductCode(decodedText)
      if (!productCode) {
        setMessage({ type: 'error', text: '空のQRコードは読み取れません' })
        return
      }

      const now = Date.now()
      const lastAt = lastScannedAtRef.current.get(productCode) || 0
      if (now - lastAt < 900) {
        return
      }
      lastScannedAtRef.current.set(productCode, now)

      // 製品情報を取得
      const productRes = await fetch(`/api/stock/product?code=${productCode}`)
      const productData = await productRes.json()

      if (productData.success && productData.data) {
        const currentStock = productData.stock?.current_stock || 0

        // 既に登録済みの場合はスキップ
        const existing = scannedItems.find((item) => item.product_code === productCode)
        if (existing) {
          setMessage({ type: 'success', text: `既に登録済み: ${productData.data.name}` })
          return
        }

        // 新しい商品を入力フェーズへ
        const newItem: ScannedItem = {
          product_code: productCode,
          product_name: productData.data.name,
          quantity: 0,
          current_stock: currentStock,
        }
        setCurrentInputItem(newItem)
        notifyScanSuccess(productData.data.name, productCode, false)
        
        // スキャナーを停止して入力フェーズへ
        await stopScanner()
        setPhase('inputting')
      } else {
        setMessage({ type: 'error', text: `製品が見つかりません: ${productCode}` })
      }
    } catch (e) {
      console.error('読取処理エラー:', e)
      setMessage({ type: 'error', text: 'QRコードの読み取りに失敗しました' })
    }
  }

  // 入力完了→スキャン再開
  const handleInputComplete = () => {
    if (!currentInputItem || currentInputItem.quantity <= 0) {
      setMessage({ type: 'error', text: '1以上の数量を入力してください' })
      return
    }
    // リストに追加（一時保存）
    setScannedItems((prev) => [...prev, currentInputItem])
    setCurrentInputItem(null)
    setMessage(null)
    // スキャンフェーズに戻る（useEffect で startScanner が呼ばれる）
    setPhase('scanning')
  }

  // 入力完了→確認へ
  const handleInputAndConfirm = () => {
    if (!currentInputItem || currentInputItem.quantity <= 0) {
      setMessage({ type: 'error', text: '1以上の数量を入力してください' })
      return
    }
    // リストに追加（一時保存）
    setScannedItems((prev) => [...prev, currentInputItem])
    setCurrentInputItem(null)
    setMessage(null)
    // 結果フェーズへ
    setPhase('result')
  }

  // QRコードスキャナーの初期化（複数モード対応）
  const startScanner = async (fpsOverride?: number) => {
    try {
      const fps = fpsOverride ?? scanFps
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode('qr-reader')
      }

      await scannerRef.current.start(
        { facingMode: 'environment' },
        {
          fps,
          qrbox: { width: 250, height: 250 },
        },
        async (decodedText) => {
          console.log('QRコード読み取り:', decodedText)

          if (scanMode === 'single') {
            // 単一モード：既存の処理
            try {
              const productCode = extractProductCode(decodedText)
              if (!productCode) {
                setMessage({ type: 'error', text: 'QRコードの内容が空です' })
                return
              }
              setScannedData({ code: productCode })

              if (scannerRef.current?.isScanning) {
                await scannerRef.current.stop()
              }
              setScanning(false)

              await fetchProductAndStock(productCode)
            } catch (e) {
              console.error('QRコードパースエラー:', e)
              setMessage({ type: 'error', text: 'QRコードの形式が正しくありません' })
            }
          } else if (scanMode === 'multiple') {
            // 複数モード：リストに追加
            await handleMultipleScan(decodedText)
          }
        },
        (errorMessage) => {
          // エラーは無視（継続的にスキャン中）
        }
      )

      setScanning(true)
    } catch (err) {
      console.error('カメラ起動エラー:', err)
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setMessage({
          type: 'error',
          text: 'カメラのアクセスが拒否されました。ブラウザの設定でカメラの使用を許可してください。',
        })
      } else {
        setMessage({ type: 'error', text: 'カメラの起動に失敗しました' })
      }
    }
  }

  const handleScanSpeedChange = async (value: number) => {
    setScanFps(value)
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop()
      setScanning(false)
      await startScanner(value)
    }
  }

  // スキャナー停止
  const stopScanner = async () => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop()
    }
    setScanning(false)
  }

  // 製品情報と在庫情報を取得
  const fetchProductAndStock = async (productCode: string) => {
    try {
      const productRes = await fetch(`/api/stock/product?code=${productCode}`)
      const productData = await productRes.json()

      if (productData.success && productData.data) {
        setProduct(productData.data)
        setStockInfo(productData.stock || { current_stock: 0 })
        fetchHistory(productCode)
      } else {
        setMessage({ type: 'error', text: '製品が見つかりません' })
      }
    } catch (error) {
      console.error('製品情報取得エラー:', error)
      setMessage({ type: 'error', text: '製品情報の取得に失敗しました' })
    }
  }

  // 履歴を取得
  const fetchHistory = async (productCode: string) => {
    try {
      const res = await fetch(`/api/stock/history?code=${productCode}&limit=10`)
      const data = await res.json()
      if (data.success) {
        setHistory(data.data || [])
      }
    } catch (error) {
      console.error('履歴取得エラー:', error)
    }
  }

  // 複数読取リストから実行
  const executeScannedItem = async (item: ScannedItem) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      setMessage({ type: 'error', text: `${item.product_name} の数量を入力してください` })
      return
    }

    setIsProcessing(true)
    setMessage(null)

    try {
      const staffData = sessionStorage.getItem('staff')
      let loginId = null
      let staffName = null
      if (staffData) {
        try {
          const staff = JSON.parse(staffData)
          loginId = staff.login_id
          staffName = staff.name
        } catch (e) {
          console.error('スタッフ情報の取得エラー:', e)
        }
      }

      const response = await fetch('/api/stock/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: item.product_code,
          type: operationType,
          quantity: operationType === 'out' ? -item.quantity : item.quantity,
          actual_quantity: operationType === 'count' ? item.quantity : undefined,
          note: usagePurpose.trim() || undefined,
          login_id: loginId,
          staff_name: staffName,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setMessage({ type: 'success', text: `${item.product_name} - 処理完了` })
        // リストから削除
        setScannedItems((prev) => prev.filter((i) => i.product_code !== item.product_code))
        // 当日履歴を更新
        await fetchTodayMovements()
      } else {
        setMessage({ type: 'error', text: data.error || `${item.product_name} - 処理失敗` })
      }
    } catch (error) {
      console.error('在庫操作エラー:', error)
      setMessage({ type: 'error', text: '在庫操作に失敗しました' })
    } finally {
      setIsProcessing(false)
    }
  }

  // 在庫操作を実行（単一モード）
  const handleStockOperation = async () => {
    if (!product || !scannedData) return
    if (quantity === null) {
      setMessage({ type: 'error', text: '数量を入力してください' })
      return
    }

    setIsProcessing(true)
    setMessage(null)

    try {
      const staffData = sessionStorage.getItem('staff')
      let loginId = null
      let staffName = null
      if (staffData) {
        try {
          const staff = JSON.parse(staffData)
          loginId = staff.login_id
          staffName = staff.name
        } catch (e) {
          console.error('スタッフ情報の取得エラー:', e)
        }
      }

      const response = await fetch('/api/stock/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: product.product_code,
          type: operationType,
          quantity: operationType === 'out' ? -quantity : quantity,
          actual_quantity: operationType === 'count' ? quantity : undefined,
          note: usagePurpose.trim() || undefined,
          login_id: loginId,
          staff_name: staffName,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setMessage({ type: 'success', text: '在庫操作が完了しました' })
        await fetchProductAndStock(product.product_code)
        await fetchTodayMovements()
        setQuantity(null)
        setUsagePurpose('')
      } else {
        setMessage({ type: 'error', text: data.error || '在庫操作に失敗しました' })
      }
    } catch (error) {
      console.error('在庫操作エラー:', error)
      setMessage({ type: 'error', text: '在庫操作に失敗しました' })
    } finally {
      setIsProcessing(false)
    }
  }

  // 手動入力でスキャン
  const handleManualInput = async () => {
    if (!manualCode.trim()) return

    setMessage(null)
    if (scanMode === 'single') {
      await fetchProductAndStock(manualCode.trim())
    } else if (scanMode === 'multiple') {
      await handleMultipleScan(manualCode.trim())
    }
    setManualCode('')
  }

  // モード選択処理
  const handleModeSelect = (mode: 'single' | 'multiple') => {
    setScanMode(mode)
    setPhase('setup')
    setScannedItems([])
    setProduct(null)
    setQuantity(null)
    setMessage(null)
  }

  // セットアップ完了 → スキャン開始
  const handleStartScanning = () => {
    if (!operationType) {
      setMessage({ type: 'error', text: '操作種別を選択してください' })
      return
    }
    setPhase('scanning')
    // startScanner() は useEffect で呼び出される
  }

  // スキャン完了
  const handleScanningDone = () => {
    stopScanner()
    if (scanMode === 'single' && product) {
      // 単一モード：製品情報画面へ
      setPhase('result')
    } else if (scanMode === 'multiple' && (scannedItems.length > 0 || currentInputItem)) {
      // 複数モード：結果リスト画面へ
      if (currentInputItem) {
        setScannedItems((prev) => [...prev, currentInputItem])
        setCurrentInputItem(null)
      }
      setPhase('result')
    } else {
      setMessage({ type: 'error', text: '読み取り結果がありません' })
      setPhase('scanning')
    }
  }

  // 複数アイテムをまとめて実行
  const executeAllScannedItems = async () => {
    // 未入力のデータをフィルタリング
    const validItems = scannedItems.filter((item) => item.quantity > 0)
    if (validItems.length === 0) {
      setMessage({ type: 'error', text: '数量が1以上の品目がありません' })
      return
    }

    setIsProcessing(true)
    let successCount = 0
    let failureCount = 0

    try {
      const staffData = sessionStorage.getItem('staff')
      let loginId = null
      let staffName = null
      if (staffData) {
        try {
          const staff = JSON.parse(staffData)
          loginId = staff.login_id
          staffName = staff.name
        } catch (e) {
          console.error('スタッフ情報の取得エラー:', e)
        }
      }

      for (const item of validItems) {
        try {
          const response = await fetch('/api/stock/movement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_code: item.product_code,
              type: operationType,
              quantity: operationType === 'out' ? -item.quantity : item.quantity,
              actual_quantity: operationType === 'count' ? item.quantity : undefined,
              note: usagePurpose.trim() || undefined,
              login_id: loginId,
              staff_name: staffName,
            }),
          })

          const data = await response.json()
          if (data.success) {
            successCount++
          } else {
            failureCount++
          }
        } catch (error) {
          console.error('個別処理エラー:', error)
          failureCount++
        }
      }

      if (failureCount === 0) {
        setMessage({ type: 'success', text: `${successCount}件の在庫操作が完了しました` })
        setScannedItems([])
        setCurrentInputItem(null)
        await fetchTodayMovements()
      } else {
        setMessage({
          type: 'error',
          text: `${successCount}件成功, ${failureCount}件失敗しました`,
        })
      }
    } catch (error) {
      console.error('一括実行エラー:', error)
      setMessage({ type: 'error', text: '一括実行に失敗しました' })
    } finally {
      setIsProcessing(false)
    }
  }

  // 新しくスキャン
  const handleNewScan = () => {
    setScannedData(null)
    setProduct(null)
    setStockInfo(null)
    setQuantity(null)
    setMessage(null)
    setPhase('mode-select')
    setScanMode('select')
    setScannedItems([])
    setCurrentInputItem(null)
  }

  // クリーンアップとセットアップ
  // phase が 'scanning' に変わったときにカメラを起動
  useEffect(() => {
    if (phase === 'scanning') {
      // DOM描画を待つため少しディレイ
      const timer = setTimeout(() => {
        startScanner()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    // 当日履歴の初期取得と定期更新
    fetchTodayMovements()
    historyRefreshIntervalRef.current = setInterval(() => {
      fetchTodayMovements()
    }, 5000) // 5秒ごとに更新

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop()
      }
      if (historyRefreshIntervalRef.current) {
        clearInterval(historyRefreshIntervalRef.current)
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-cyan-950 to-slate-950 pb-20 relative overflow-hidden">
      {/* 背景パターン */}
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" viewBox="0 0 1200 800">
          <pattern id="circuit" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <path d="M 0 50 L 50 50 L 50 0" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <path d="M 150 150 L 100 150 L 100 200" stroke="currentColor" strokeWidth="2" fill="none" className="text-cyan-400" />
            <circle cx="50" cy="50" r="3" fill="currentColor" className="text-cyan-400" />
            <circle cx="100" cy="150" r="3" fill="currentColor" className="text-cyan-400" />
          </pattern>
          <rect width="1200" height="800" fill="url(#circuit)" />
        </svg>
      </div>

      {/* ヘッダー */}
      <div className="relative z-10 bg-cyan-900/30 border-b-2 border-cyan-500 backdrop-blur sticky top-0">
        <div className="flex items-center justify-between px-4 py-4">
          <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
            在庫管理 - QRスキャン
          </h1>
          <Link
            href="/"
            className="px-4 py-2 border-2 border-cyan-400 text-cyan-400 rounded-lg font-semibold hover:bg-cyan-900/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] transition whitespace-nowrap"
          >
            🏠 ホーム
          </Link>
        </div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto p-4 space-y-4">
        {/* メッセージ */}
        {message && (
          <div
            className={`p-3 rounded-md border-2 ${
              message.type === 'success'
                ? 'bg-green-900/20 text-green-300 border-green-400'
                : 'bg-red-900/20 text-red-300 border-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* ① モード選択フェーズ */}
        {phase === 'mode-select' && (
          <div className="border-2 border-cyan-500 bg-cyan-900/10 rounded-xl p-8 backdrop-blur text-center">
            <h2 className="text-3xl font-bold text-cyan-300 mb-6">📋 スキャンモードを選択</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleModeSelect('single')}
                className="p-8 border-2 border-blue-400 bg-blue-900/20 text-blue-300 rounded-lg hover:bg-blue-900/30 hover:shadow-[0_0_15px_rgba(59,130,246,0.5)] transition"
              >
                <div className="text-4xl mb-2">📦</div>
                <div className="text-xl font-bold">単一部品</div>
                <div className="text-sm mt-2">1つの部品を</div>
                <div className="text-sm">入出庫</div>
              </button>
              <button
                onClick={() => handleModeSelect('multiple')}
                className="p-8 border-2 border-purple-400 bg-purple-900/20 text-purple-300 rounded-lg hover:bg-purple-900/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] transition"
              >
                <div className="text-4xl mb-2">📦📦📦</div>
                <div className="text-xl font-bold">複数部品</div>
                <div className="text-sm mt-2">複数の部品を</div>
                <div className="text-sm">一括読取</div>
              </button>
            </div>
          </div>
        )}

        {/* ② セットアップフェーズ */}
        {phase === 'setup' && (
          <div className="border-2 border-cyan-500 bg-cyan-900/10 rounded-xl p-6 backdrop-blur space-y-4">
            <h2 className="text-2xl font-bold text-cyan-300">⚙️ 操作設定</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">操作種別</label>
                <div className="space-y-2">
                  <button
                    onClick={() => setOperationType('out')}
                    className={`w-full py-3 rounded-lg font-semibold transition border-2 ${
                      operationType === 'out'
                        ? 'bg-red-900/40 border-red-400 text-red-300'
                        : 'bg-slate-800 border-gray-600 text-gray-300 hover:border-red-400'
                    }`}
                  >
                    ❌ 出庫
                  </button>
                  <button
                    onClick={() => setOperationType('in')}
                    className={`w-full py-3 rounded-lg font-semibold transition border-2 ${
                      operationType === 'in'
                        ? 'bg-green-900/40 border-green-400 text-green-300'
                        : 'bg-slate-800 border-gray-600 text-gray-300 hover:border-green-400'
                    }`}
                  >
                    ✅ 入庫
                  </button>
                  <button
                    onClick={() => setOperationType('count')}
                    className={`w-full py-3 rounded-lg font-semibold transition border-2 ${
                      operationType === 'count'
                        ? 'bg-yellow-900/40 border-yellow-400 text-yellow-300'
                        : 'bg-slate-800 border-gray-600 text-gray-300 hover:border-yellow-400'
                    }`}
                  >
                    📊 棚卸
                  </button>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">使用目的</label>
                <textarea
                  value={usagePurpose}
                  onChange={(e) => setUsagePurpose(e.target.value)}
                  placeholder="例: 製造Aライン, 修理対応, 品質確認用"
                  className="w-full px-4 py-3 bg-slate-800 border-2 border-cyan-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-300 focus:shadow-[0_0_10px_rgba(34,211,238,0.5)] resize-none h-24"
                />
              </div>
            </div>

            <button
              onClick={handleStartScanning}
              disabled={!operationType}
              className="w-full px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg text-lg font-semibold hover:shadow-[0_0_20px_rgba(34,211,238,0.6)] disabled:opacity-50 transition"
            >
              📷 カメラを起動してスキャン
            </button>

            <button
              onClick={handleNewScan}
              className="w-full px-6 py-2 border-2 border-gray-400 text-gray-300 rounded-lg font-semibold hover:bg-gray-900/30 transition"
            >
              ← 戻る
            </button>
          </div>
        )}

        {/* ③ スキャンフェーズ */}
        {phase === 'scanning' && (
          <div className="space-y-4">
            <div className="border-2 border-cyan-500 bg-cyan-900/10 rounded-xl p-6 backdrop-blur">
              <h3 className="text-lg font-semibold text-cyan-300 mb-4">📷 QRコードをスキャン</h3>
              <div id="qr-reader" className="w-full rounded-lg overflow-hidden mb-4"></div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">スキャン速度: {scanFps} fps</label>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={scanFps}
                  onChange={(e) => handleScanSpeedChange(parseInt(e.target.value, 10))}
                  className="w-full accent-cyan-400"
                />
                <p className="text-xs text-gray-500 mt-2">低速 = 精度優先 / 高速 = 反応優先</p>
              </div>

              {!scanning ? (
                <button
                  onClick={() => startScanner()}
                  className="w-full mt-4 px-6 py-4 border-2 border-cyan-400 text-cyan-400 rounded-lg text-lg font-semibold hover:bg-cyan-900/30 hover:shadow-[0_0_15px_rgba(34,211,238,0.5)] transition"
                >
                  📷 カメラを再起動
                </button>
              ) : (
                <button
                  onClick={stopScanner}
                  className="w-full mt-4 px-6 py-4 border-2 border-red-400 text-red-400 rounded-lg text-lg font-semibold hover:bg-red-900/30 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)] transition"
                >
                  ⏹ スキャン停止
                </button>
              )}

              <div className="mt-6 pt-6 border-t border-cyan-500">
                <h3 className="text-lg font-semibold text-cyan-300 mb-4">製品コードを手動入力</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleManualInput()}
                    placeholder="例: TEST-001, 85088500"
                    className="flex-1 px-4 py-3 bg-slate-800 border-2 border-cyan-400 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-cyan-300"
                  />
                  <button
                    onClick={handleManualInput}
                    className="px-6 py-3 border-2 border-green-400 text-green-400 rounded-lg font-semibold hover:bg-green-900/30 transition"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>

            {/* 複数モード時のスキャン結果プレビュー（常時表示） */}
            {scanMode === 'multiple' && (
              <div className="border-2 border-purple-500 bg-purple-900/10 rounded-xl p-6 backdrop-blur">
                <h3 className="text-lg font-semibold text-purple-300 mb-4">
                  📦 読取中...({scannedItems.length}件)
                </h3>
                {scannedItems.length === 0 ? (
                  <p className="text-center text-gray-500 py-6">QRコードをスキャンしてください</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {scannedItems.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-slate-800 p-4 rounded-lg border border-purple-600">
                        <div className="flex-1">
                          <div className="font-semibold text-purple-300">{item.product_name}</div>
                          <div className="text-sm text-gray-500">{item.product_code}</div>
                          <div className="text-xs text-gray-400 mt-1">現在庫: <span className="text-blue-400 font-semibold">{item.current_stock}</span></div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold text-cyan-300 min-w-[84px] text-right">登録済み</div>
                          <button
                            onClick={() => setScannedItems((prev) => prev.filter((i) => i.product_code !== item.product_code))}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 単一モード時の製品情報 */}
            {scanMode === 'single' && product && (
              <div className="border-2 border-cyan-500 bg-cyan-900/10 rounded-xl p-6 backdrop-blur">
                <h2 className="text-lg font-bold text-cyan-300 mb-4">製品情報</h2>
                <div className="space-y-3 text-gray-300 mb-4">
                  <div className="flex justify-between">
                    <span>製品コード:</span>
                    <span className="font-semibold text-cyan-300">{product.product_code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>製品名:</span>
                    <span className="font-semibold text-cyan-300">{product.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>現在庫:</span>
                    <span className="text-2xl font-bold text-cyan-400">{stockInfo?.current_stock || 0}</span>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {operationType === 'count' ? '実在庫数' : '数量'}
                  </label>
                  <input
                    type="number"
                    value={quantity ?? ''}
                    onChange={(e) => {
                      const nextValue = e.target.value
                      if (nextValue === '') {
                        setQuantity(null)
                        return
                      }
                      const parsed = parseInt(nextValue, 10)
                      setQuantity(Number.isNaN(parsed) ? null : Math.max(1, parsed))
                    }}
                    className="w-full px-4 py-3 bg-slate-800 border-2 border-cyan-400 rounded-lg text-white focus:outline-none focus:border-cyan-300"
                    min="1"
                  />
                </div>

                <button
                  onClick={handleStockOperation}
                  disabled={isProcessing || quantity === null}
                  className="w-full px-6 py-4 border-2 border-cyan-400 text-cyan-400 rounded-lg text-lg font-semibold hover:bg-cyan-900/30 disabled:opacity-50 transition"
                >
                  {isProcessing ? '処理中...' : '実行'}
                </button>
              </div>
            )}

            <div className="border-t-2 border-cyan-500 pt-4">
              {scanMode === 'multiple' ? (
                <button
                  onClick={handleScanningDone}
                  disabled={scannedItems.length === 0 && !currentInputItem}
                  className="w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg text-lg font-bold hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  ✓ 読取完了 → 確認へ ({scannedItems.length}件)
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-center text-sm text-gray-400">部品をスキャンして「実行」を押してから完了してください</p>
                  <button
                    onClick={handleScanningDone}
                    disabled={!product}
                    className="w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg text-lg font-bold hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    ✓ スキャン完了
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ③-2 数量入力フェーズ（複数モード） */}
        {phase === 'inputting' && scanMode === 'multiple' && currentInputItem && (
          <div className="space-y-4">
            <div className="border-2 border-blue-500 bg-blue-900/10 rounded-xl p-6 backdrop-blur">
              <h2 className="text-2xl font-bold text-blue-300 mb-4">📝 数量を入力してください</h2>

              <div className="border-2 border-blue-600 bg-slate-800 p-4 rounded-lg mb-4">
                <div className="mb-3">
                  <div className="font-bold text-lg text-blue-300">{currentInputItem.product_name}</div>
                  <div className="text-sm text-gray-500">{currentInputItem.product_code}</div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="text-xs text-gray-400">現在庫</label>
                    <div className="text-2xl font-bold text-blue-400">{currentInputItem.current_stock}</div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400">
                      {operationType === 'in' ? '入庫数' : operationType === 'out' ? '出庫数' : '棚卸数'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={currentInputItem.quantity}
                      onChange={(e) => {
                        const rawValue = e.target.value
                        if (rawValue === '') {
                          setCurrentInputItem((prev) => prev ? { ...prev, quantity: 0 } : null)
                          return
                        }

                        const newQty = parseInt(rawValue, 10)
                        if (!Number.isNaN(newQty) && newQty > 0) {
                          setCurrentInputItem((prev) => prev ? { ...prev, quantity: newQty } : null)
                        }
                      }}
                      className="w-full px-3 py-2 bg-cyan-900 border-2 border-cyan-400 rounded text-white font-bold text-center focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-400">残高</label>
                    <div className={`text-2xl font-bold ${
                      (operationType === 'out' 
                        ? currentInputItem.current_stock - currentInputItem.quantity 
                        : currentInputItem.current_stock + currentInputItem.quantity) < 0
                        ? 'text-red-400'
                        : 'text-green-400'
                    }`}>
                      {operationType === 'out'
                        ? currentInputItem.current_stock - currentInputItem.quantity
                        : currentInputItem.current_stock + currentInputItem.quantity}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleInputComplete}
                  disabled={currentInputItem.quantity <= 0}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] disabled:opacity-50 transition"
                >
                  ✓ この数量で登録 → 次を読み取る
                </button>
                <button
                  onClick={handleInputAndConfirm}
                  disabled={currentInputItem.quantity <= 0}
                  className="w-full px-6 py-3 border-2 border-blue-400 text-blue-400 rounded-lg font-semibold hover:bg-blue-900/30 disabled:opacity-50 transition"
                >
                  ✓ この数量で登録 → 確認へ進む
                </button>
                <button
                  onClick={() => {
                    setCurrentInputItem(null)
                    setPhase('scanning')
                    startScanner()
                  }}
                  className="w-full px-6 py-3 border-2 border-gray-400 text-gray-300 rounded-lg font-semibold hover:bg-gray-900/30 transition"
                >
                  ← キャンセル
                </button>
              </div>
            </div>

            {/* これまでのスキャン結果 */}
            {scannedItems.length > 0 && (
              <div className="border-2 border-purple-500 bg-purple-900/10 rounded-xl p-6 backdrop-blur">
                <h3 className="text-lg font-semibold text-purple-300 mb-4">
                  📦 登録済み ({scannedItems.length}件)
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {scannedItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-800 p-3 rounded-lg border border-purple-600">
                      <div className="flex-1">
                        <div className="font-semibold text-purple-300 text-sm">{item.product_name}</div>
                        <div className="text-xs text-gray-500">{item.product_code}</div>
                      </div>
                      <div className="text-sm font-semibold text-cyan-300 min-w-[60px] text-right">
                        {operationType === 'out' ? '-' : '+'}{item.quantity}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ④ 結果フェーズ（複数モード） */}
        {phase === 'result' && scanMode === 'multiple' && (
          <div className="space-y-4">
            <div className="border-2 border-green-500 bg-green-900/10 rounded-xl p-6 backdrop-blur">
              <h2 className="text-2xl font-bold text-green-300 mb-4">📦 読取結果 ({scannedItems.length}件)</h2>

              {scannedItems.length === 0 ? (
                <p className="text-center text-gray-400 py-4">読取アイテムがありません</p>
              ) : (
                <div className="space-y-4">
                  {scannedItems.map((item, idx) => {
                    // 残高を計算
                    let balance = item.current_stock
                    if (operationType === 'in') {
                      balance = item.current_stock + item.quantity
                    } else if (operationType === 'out') {
                      balance = item.current_stock - item.quantity
                    }
                    
                    return (
                      <div key={idx} className="border-2 border-green-600 bg-slate-800 p-4 rounded-lg">
                        <div className="mb-3">
                          <div className="font-bold text-lg text-green-300">{item.product_name}</div>
                          <div className="text-sm text-gray-500">{item.product_code}</div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                          <div>
                            <label className="text-xs text-gray-400">現在庫</label>
                            <div className="text-2xl font-bold text-blue-400">{item.current_stock}</div>
                          </div>
                          
                          <div>
                            <label className="text-xs text-gray-400">
                              {operationType === 'in' ? '入庫数' : operationType === 'out' ? '出庫数' : '棚卸数'}
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={item.quantity}
                              onChange={(e) => {
                                const rawValue = e.target.value
                                if (rawValue === '') {
                                  setScannedItems((prev) =>
                                    prev.map((i) =>
                                      i.product_code === item.product_code ? { ...i, quantity: 0 } : i
                                    )
                                  )
                                  return
                                }

                                const newQty = parseInt(rawValue, 10)
                                if (!Number.isNaN(newQty) && newQty >= 0) {
                                  setScannedItems((prev) =>
                                    prev.map((i) =>
                                      i.product_code === item.product_code ? { ...i, quantity: newQty } : i
                                    )
                                  )
                                }
                              }}
                              className="w-full px-2 py-1 bg-cyan-900 border-2 border-cyan-400 rounded text-white font-bold text-center focus:outline-none"
                            />
                          </div>
                          
                          <div>
                            <label className="text-xs text-gray-400">残高</label>
                            <div className={`text-2xl font-bold ${balance < 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {balance}
                            </div>
                          </div>
                          
                          <div className="col-span-2 md:col-span-2 flex items-end justify-end">
                            <button
                              onClick={() => setScannedItems((prev) => prev.filter((i) => i.product_code !== item.product_code))}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
                            >
                              × 削除
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={executeAllScannedItems}
                  disabled={isProcessing || scannedItems.filter((i) => i.quantity > 0).length === 0}
                  className="flex-1 px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-bold hover:shadow-[0_0_20px_rgba(217,119,6,0.7)] disabled:opacity-50 disabled:cursor-not-allowed transition text-lg"
                >
                  {isProcessing ? '処理中...' : '🔘 まとめて実行'}
                </button>
                <button
                  onClick={handleNewScan}
                  className="flex-1 px-6 py-3 border-2 border-cyan-400 text-cyan-400 rounded-lg font-semibold hover:bg-cyan-900/30 transition"
                >
                  🔄 新しくスキャン
                </button>
                <button
                  onClick={() => {
                    stopScanner()
                    setPhase('mode-select')
                    setScanMode('select')
                  }}
                  className="flex-1 px-6 py-3 border-2 border-gray-400 text-gray-300 rounded-lg font-semibold hover:bg-gray-900/30 transition"
                >
                  終了
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ④ 結果フェーズ（単一モード） */}
        {phase === 'result' && scanMode === 'single' && product && (
          <div className="space-y-4">
            <div className="border-2 border-cyan-500 bg-cyan-900/10 rounded-xl p-6 backdrop-blur">
              <h2 className="text-lg font-bold text-cyan-300 mb-4">製品情報</h2>
              <div className="space-y-3 text-gray-300 mb-4">
                <div className="flex justify-between">
                  <span>製品コード:</span>
                  <span className="font-semibold text-cyan-300">{product.product_code}</span>
                </div>
                <div className="flex justify-between">
                  <span>製品名:</span>
                  <span className="font-semibold text-cyan-300">{product.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>現在庫:</span>
                  <span className="text-2xl font-bold text-cyan-400">{stockInfo?.current_stock || 0}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleNewScan}
              className="w-full px-6 py-3 border-2 border-cyan-400 text-cyan-400 rounded-lg font-semibold hover:bg-cyan-900/30 transition"
            >
              🔄 新しくスキャン
            </button>
          </div>
        )}
      </div>

      {/* 当日履歴パネル */}
      {phase !== 'mode-select' && (
        <div className="relative z-10 max-w-4xl mx-auto p-4">
          <div className="border-2 border-yellow-600 bg-yellow-900/20 rounded-xl p-4 backdrop-blur">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-yellow-300">📝 本日の在庫移動ログ</h3>
              <button
                onClick={() => setShowTodayHistory(!showTodayHistory)}
                className="text-yellow-400 text-sm font-semibold hover:text-yellow-300"
              >
                {showTodayHistory ? '▲ 閉じる' : '▼ 表示'}
              </button>
            </div>

            {showTodayHistory && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {todayMovements.length === 0 ? (
                  <p className="text-center text-gray-500 py-4">本日のログはありません</p>
                ) : (
                  todayMovements.map((item) => (
                    <div key={item.id} className="flex justify-between items-center text-sm bg-slate-800/50 p-3 rounded">
                      <div className="flex items-center gap-3 flex-1">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold border ${
                            item.movement === 'IN'
                              ? 'bg-green-900/30 text-green-300 border-green-500'
                              : item.movement === 'OUT'
                                ? 'bg-red-900/30 text-red-300 border-red-500'
                                : 'bg-yellow-900/30 text-yellow-300 border-yellow-500'
                          }`}
                        >
                          {item.movement_label}
                        </span>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-200">{item.product_name}</div>
                          <div className="text-xs text-gray-500">{item.product_code}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-yellow-300">{item.qty > 0 ? '+' : ''}{item.qty}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(item.created_at).toLocaleString('ja-JP', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
