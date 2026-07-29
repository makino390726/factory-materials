import { redirect } from 'next/navigation'

type Props = {
  searchParams: Promise<{ id?: string; work_order_id?: string }>
}

/**
 * 旧 /work-orders/bom-cost は機種標準原価画面へ統合。
 * ブックマーク互換のためリダイレクトのみ残す。
 */
export default async function BomCostRedirectPage({ searchParams }: Props) {
  const sp = await searchParams
  const id = sp.work_order_id || sp.id
  if (id) {
    redirect(`/heater/models/dr8008?work_order_id=${encodeURIComponent(id)}`)
  }
  redirect('/heater/models/dr8008?source=heater_model')
}
