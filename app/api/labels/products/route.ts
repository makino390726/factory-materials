import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import QRCode from 'qrcode'
import { readFile } from 'fs/promises'
import path from 'path'

// mm → pt (PDF座標系: 1mm = 2.83465pt)
const mm2pt = (mm: number) => mm * 2.83465

type ProductLabelData = {
  product_code: string
  name: string
  shelf_no?: string | null
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { products, quantity = 1, labelSize = '40x30' } = body

    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json({ error: '製品データが必要です' }, { status: 400 })
    }

    // ラベルサイズをmm→ポイントに変換
    const [widthMm, heightMm] = labelSize.split('x').map((v: string) => parseFloat(v))
    const labelWidth = mm2pt(widthMm)
    const labelHeight = mm2pt(heightMm)

    // A4サイズ（210mm x 297mm）
    const a4Width = mm2pt(210)
    const a4Height = mm2pt(297)

    // 余白設定（上下左右 10mm）
    const marginTop = mm2pt(10)
    const marginBottom = mm2pt(10)
    const marginLeft = mm2pt(10)
    const marginRight = mm2pt(10)

    // 印刷可能領域
    const printableWidth = a4Width - marginLeft - marginRight
    const printableHeight = a4Height - marginTop - marginBottom

    // A4用紙に配置できるラベル数を計算
    const labelsPerRow = Math.floor(printableWidth / labelWidth)
    const labelsPerColumn = Math.floor(printableHeight / labelHeight)
    const labelsPerPage = labelsPerRow * labelsPerColumn

    // PDFドキュメント作成
    const pdfDoc = await PDFDocument.create()
    
    // fontkitを登録（カスタムフォント使用に必要）
    pdfDoc.registerFontkit(fontkit)
    
    // 日本語フォントを読み込み
    let font, fontBold
    try {
      const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf')
      const fontBytes = await readFile(fontPath)
      font = await pdfDoc.embedFont(fontBytes)
      fontBold = font // OTFの場合、太字は同じフォントを使用
    } catch (error) {
      console.error('日本語フォント読み込みエラー:', error)
      // フォールバック: 標準フォントを使用（日本語は表示されません）
      font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    }

    // 全ラベルデータを作成
    const allLabels: Array<{ product: ProductLabelData; index: number }> = []
    for (const product of products) {
      for (let i = 0; i < quantity; i++) {
        allLabels.push({ product, index: i })
      }
    }

    // ページごとにラベルを配置
    let currentLabelIndex = 0
    while (currentLabelIndex < allLabels.length) {
      // 新しいA4ページを追加
      const page = pdfDoc.addPage([a4Width, a4Height])

      // このページに配置するラベル数
      const labelsOnThisPage = Math.min(labelsPerPage, allLabels.length - currentLabelIndex)

      for (let i = 0; i < labelsOnThisPage; i++) {
        const labelData = allLabels[currentLabelIndex + i]
        const { product } = labelData

        // ラベルの位置を計算（左上から右へ、上から下へ）
        const row = Math.floor(i / labelsPerRow)
        const col = i % labelsPerRow
        const xOffset = marginLeft + col * labelWidth
        const yOffset = a4Height - marginTop - (row + 1) * labelHeight

        // ラベルの境界線を描画
        page.drawRectangle({
          x: xOffset,
          y: yOffset,
          width: labelWidth,
          height: labelHeight,
          borderColor: rgb(0.7, 0.7, 0.7),
          borderWidth: 0.5,
        })

        // QRコードを生成
        const qrDataURL = await QRCode.toDataURL(
          JSON.stringify({
            code: product.product_code,
            name: product.name,
            shelf_no: product.shelf_no || null,
          }),
          { width: 500, margin: 1, errorCorrectionLevel: 'M' }
        )

        const qrImageBytes = Buffer.from(qrDataURL.split(',')[1], 'base64')
        const qrImage = await pdfDoc.embedPng(qrImageBytes)

        // QRコードのサイズと位置（ラベル内の上部中央に配置）
        const qrSize = Math.min(labelWidth, labelHeight * 0.6) - mm2pt(6)
        const qrX = xOffset + (labelWidth - qrSize) / 2
        const qrY = yOffset + labelHeight - qrSize - mm2pt(2)

        // QRコード描画
        page.drawImage(qrImage, {
          x: qrX,
          y: qrY,
          width: qrSize,
          height: qrSize,
        })

        // 製品名（QRコードの下、2行対応）
        const nameText = product.name || ''
        if (nameText) {
          const nameSize = 10
          const maxWidth = labelWidth - mm2pt(4)
          const lineHeight = nameSize * 1.2
          
          // テキストを2行に分割
          const nameWidth = font.widthOfTextAtSize(nameText, nameSize)
          
          if (nameWidth > maxWidth) {
            // 長い場合は2行に分割
            const mid = Math.floor(nameText.length / 2)
            // 空白で分割可能な位置を探す
            let splitPos = mid
            for (let i = mid; i < nameText.length && i < mid + 10; i++) {
              if (nameText[i] === ' ' || nameText[i] === '　') {
                splitPos = i
                break
              }
            }
            
            const line1 = nameText.substring(0, splitPos).trim()
            const line2 = nameText.substring(splitPos).trim()
            
            // 1行目
            const line1Width = font.widthOfTextAtSize(line1, nameSize)
            const line1X = xOffset + (labelWidth - Math.min(line1Width, maxWidth)) / 2
            page.drawText(line1, {
              x: line1X,
              y: yOffset + mm2pt(12),
              size: nameSize,
              font: fontBold,
              maxWidth: maxWidth,
            })
            
            // 2行目
            const line2Width = font.widthOfTextAtSize(line2, nameSize)
            const line2X = xOffset + (labelWidth - Math.min(line2Width, maxWidth)) / 2
            page.drawText(line2, {
              x: line2X,
              y: yOffset + mm2pt(12) - lineHeight,
              size: nameSize,
              font: fontBold,
              maxWidth: maxWidth,
            })
          } else {
            // 1行で収まる場合
            const nameX = xOffset + (labelWidth - Math.min(nameWidth, maxWidth)) / 2
            page.drawText(nameText, {
              x: nameX,
              y: yOffset + mm2pt(10),
              size: nameSize,
              font: fontBold,
              maxWidth: maxWidth,
            })
          }
        }

        // 棚番（商品コードの上）
        const shelfText = product.shelf_no ? `棚番: ${product.shelf_no}` : ''
        if (shelfText) {
          const shelfSize = 7
          const shelfWidth = font.widthOfTextAtSize(shelfText, shelfSize)
          const shelfX = xOffset + (labelWidth - shelfWidth) / 2
          page.drawText(shelfText, {
            x: shelfX,
            y: yOffset + mm2pt(5),
            size: shelfSize,
            font,
          })
        }

        // 製品コード（最下部中央）
        const codeText = product.product_code || ''
        if (codeText) {
          const codeSize = 7
          const codeWidth = font.widthOfTextAtSize(codeText, codeSize)
          const codeX = xOffset + (labelWidth - codeWidth) / 2
          page.drawText(codeText, {
            x: codeX,
            y: yOffset + mm2pt(2),
            size: codeSize,
            font,
          })
        }
      }

      currentLabelIndex += labelsOnThisPage
    }

    // PDFをバイト配列として保存
    const pdfBytes = await pdfDoc.save()

    // PDFを返す
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=product-labels.pdf',
      },
    })
  } catch (error) {
    console.error('PDF生成エラー:', error)
    return NextResponse.json(
      { error: `PDF生成に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}` },
      { status: 500 }
    )
  }
}
