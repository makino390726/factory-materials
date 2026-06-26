'use client'

import { QRCodeSVG } from 'qrcode.react'

export interface AuditPrintItem {
  product_code: string
  name: string
  shelf_no: string | null
  stock_qty: number
}

const ITEMS_PER_PAGE = 8

const PRINT_FONT =
  "'MS Gothic', 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif"

function getQrValue(item: AuditPrintItem): string {
  return JSON.stringify({ code: item.product_code, name: item.name })
}

function formatPrintDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

interface InventoryAuditPrintProps {
  items: AuditPrintItem[]
  printDate: Date
}

export function InventoryAuditPrint({ items, printDate }: InventoryAuditPrintProps) {
  const pages = chunkItems(items, ITEMS_PER_PAGE)
  const outputDate = formatPrintDate(printDate)

  return (
    <div id="inventory-audit-print-root" className="hidden print:block">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }

          body {
            background: #fff !important;
          }

          body[data-print-target='audit-tags'] #inventory-audit-report-print-root {
            display: none !important;
          }

          #inventory-audit-print-root,
          #inventory-audit-print-root * {
            font-family: ${PRINT_FONT} !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .audit-print-page {
            width: 100%;
            height: 281mm;
            page-break-after: always;
            break-after: page;
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: repeat(4, 1fr);
            gap: 3mm;
            box-sizing: border-box;
          }

          .audit-print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          .audit-print-label {
            border: 1px dashed #333;
            padding: 3mm;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
            color: #000;
            background: #fff;
          }

          .audit-print-label-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #333;
            padding-bottom: 1.5mm;
            margin-bottom: 2mm;
            font-size: 14pt;
            font-weight: 700 !important;
          }

          .audit-print-label-body {
            display: flex;
            gap: 3mm;
            flex: 1;
            min-height: 0;
          }

          .audit-print-qr {
            flex-shrink: 0;
            width: 24mm;
            height: 24mm;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .audit-print-info {
            flex: 1;
            min-width: 0;
            font-size: 14pt;
            line-height: 1.35;
          }

          .audit-print-shelf,
          .audit-print-name {
            font-weight: 700 !important;
          }

          .audit-print-qty {
            font-size: 17pt;
            font-weight: 700 !important;
            margin-top: auto;
          }

          .audit-print-qty span {
            font-size: 20pt;
            font-weight: 700 !important;
          }
        }
      `}</style>

      {pages.map((pageItems, pageIndex) => (
        <div key={`page-${pageIndex}`} className="audit-print-page">
          {pageItems.map((item) => (
            <div key={item.product_code} className="audit-print-label">
              <div className="audit-print-label-header">
                <span>棚卸タグ</span>
                <span>出力日: {outputDate}</span>
              </div>
              <div className="audit-print-label-body">
                <div className="audit-print-qr">
                  <QRCodeSVG value={getQrValue(item)} size={80} level="M" />
                </div>
                <div className="audit-print-info">
                  <div
                    className="audit-print-shelf"
                    style={{
                      fontSize: '16pt',
                      fontWeight: 700,
                      marginBottom: '1mm',
                      wordBreak: 'break-all',
                    }}
                  >
                    <strong>棚番: {item.shelf_no || '—'}</strong>
                  </div>
                  <div
                    style={{
                      fontSize: '15pt',
                      fontWeight: 400,
                      marginBottom: '1.5mm',
                      wordBreak: 'break-all',
                    }}
                  >
                    {item.product_code}
                  </div>
                  <div
                    className="audit-print-name"
                    style={{
                      fontSize: '15pt',
                      fontWeight: 700,
                      marginBottom: '2mm',
                      wordBreak: 'break-all',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    <strong>{item.name}</strong>
                  </div>
                  <div className="audit-print-qty">
                    在庫数: <span>{item.stock_qty}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function printInventoryAuditSheet(items: AuditPrintItem[]): void {
  if (items.length === 0) {
    alert('印刷する対象がありません')
    return
  }

  const confirmed = window.confirm(
    `棚卸表（A4）を印刷します。\n対象: ${items.length} 件（1枚あたり最大${ITEMS_PER_PAGE}件）\n用紙: A4 縦`
  )
  if (!confirmed) return

  document.body.setAttribute('data-print-target', 'audit-tags')
  const clearTarget = () => document.body.removeAttribute('data-print-target')
  window.addEventListener('afterprint', clearTarget, { once: true })
  window.print()
}
