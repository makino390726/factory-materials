'use client'

export interface AuditReportPrintItem {
  shelf_no: string | null
  product_code: string
  name: string
  count_day_stock: number
  inbound_qty: number
  outbound_qty: number
  audit_stock_qty: number
}

export interface AuditReportPrintMeta {
  countDate: string
  auditDate: string
  printDate: Date
}

const PRINT_FONT =
  "'MS Gothic', 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif"

function formatDateLabel(value: string): string {
  const parsed = Date.parse(`${value}T00:00:00`)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatPrintDate(date: Date): string {
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

interface InventoryAuditReportPrintProps {
  items: AuditReportPrintItem[]
  meta: AuditReportPrintMeta | null
}

export function printAuditReportSheet(items: AuditReportPrintItem[], meta: AuditReportPrintMeta): void {
  if (items.length === 0) {
    alert('印刷する対象がありません')
    return
  }

  const countLabel = formatDateLabel(meta.countDate)
  const auditLabel = formatDateLabel(meta.auditDate)
  const confirmed = window.confirm(
    `棚卸・監査帳票（A4横）を印刷します。\n棚卸日: ${countLabel}\n現物監査日: ${auditLabel}\n対象: ${items.length} 件`
  )
  if (!confirmed) return

  document.body.setAttribute('data-print-target', 'audit-report')
  const clearTarget = () => document.body.removeAttribute('data-print-target')
  window.addEventListener('afterprint', clearTarget, { once: true })
  window.print()
}

export function InventoryAuditReportPrint({
  items,
  meta,
}: InventoryAuditReportPrintProps) {
  if (!meta || items.length === 0) return null

  const countLabel = formatDateLabel(meta.countDate)
  const auditLabel = formatDateLabel(meta.auditDate)
  const outputLabel = formatPrintDate(meta.printDate)

  return (
    <div id="inventory-audit-report-print-root" className="hidden print:block">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }

          body {
            background: #fff !important;
          }

          body[data-print-target='audit-report'] #inventory-audit-print-root {
            display: none !important;
          }

          #inventory-audit-report-print-root,
          #inventory-audit-report-print-root * {
            font-family: ${PRINT_FONT} !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .audit-report-print-sheet {
            width: 100%;
          }

          .audit-report-print-title {
            font-size: 14pt;
            font-weight: 700;
            margin-bottom: 2mm;
          }

          .audit-report-print-subtitle {
            font-size: 10pt;
            margin-bottom: 4mm;
          }

          .audit-report-print-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9pt;
            table-layout: fixed;
          }

          .audit-report-print-table thead {
            display: table-header-group;
          }

          .audit-report-print-table tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .audit-report-print-table th,
          .audit-report-print-table td {
            border: 1px solid #333;
            padding: 2mm 2mm;
            vertical-align: middle;
            word-break: break-all;
          }

          .audit-report-print-table th {
            background: #e8e8e8 !important;
            font-weight: 700;
            text-align: center;
            font-size: 8.5pt;
            line-height: 1.3;
          }

          .audit-report-print-table td.num {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }

          .audit-report-print-table td.text-left {
            text-align: left;
          }

          .audit-report-print-table td.shelf {
            text-align: center;
            font-weight: 700;
          }

          .audit-report-print-table td.name {
            text-align: left;
            font-weight: 700;
          }
        }
      `}</style>

      <div className="audit-report-print-sheet">
        <div className="audit-report-print-title">棚卸・現物監査 帳票</div>
        <div className="audit-report-print-subtitle">
          棚卸日: {countLabel}　現物監査日: {auditLabel}　出力日: {outputLabel}　件数:{' '}
          {items.length}
        </div>
        <table className="audit-report-print-table">
          <thead>
            <tr>
              <th style={{ width: '9%' }}>棚番</th>
              <th style={{ width: '12%' }}>商品コード</th>
              <th style={{ width: '24%' }}>商品名</th>
              <th style={{ width: '11%' }}>棚卸当日<br />在庫数</th>
              <th style={{ width: '11%' }}>移動<br />入庫数</th>
              <th style={{ width: '11%' }}>移動<br />出庫数</th>
              <th style={{ width: '11%' }}>現物監査時<br />在庫数</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.product_code}>
                <td className="shelf">{item.shelf_no || '—'}</td>
                <td className="text-left">{item.product_code}</td>
                <td className="name">{item.name}</td>
                <td className="num">{item.count_day_stock}</td>
                <td className="num">{item.inbound_qty}</td>
                <td className="num">{item.outbound_qty}</td>
                <td className="num">{item.audit_stock_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
