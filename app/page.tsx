'use client'

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type StaffInfo = {
  id: string
  login_id: string
  name: string
  department: string
  work_group_code: string
}

export default function Home() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);

  useEffect(() => {
    const staff = sessionStorage.getItem('staff');
    if (staff) {
      try {
        const parsedStaff = JSON.parse(staff);
        setStaffInfo(parsedStaff);
      } catch {
        setStaffInfo(null);
      }
    }
  }, []);

  // 未読通知数を取得
  useEffect(() => {
    if (!staffInfo?.id) return;

    const fetchUnreadCount = async () => {
      try {
        const response = await fetch(`/api/notifications/unread-count?staff_id=${staffInfo.id}`);
        if (response.ok) {
          const data = await response.json();
          setUnreadCount(data.unread_count || 0);
        }
      } catch (error) {
        console.error('Failed to fetch unread count:', error);
      }
    };

    // 初回取得
    fetchUnreadCount();

    // 30秒ごとに未読数をチェック
    const interval = setInterval(fetchUnreadCount, 30000);

    return () => clearInterval(interval);
  }, [staffInfo]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-purple-950 to-slate-950 relative overflow-hidden">
      {/* 背景の電子回路パターン */}
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

      {/* メインコンテンツ */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-12 space-y-4">
          <div className="flex justify-center" suppressHydrationWarning>
            <Image
              src="/company-logo.png"
              alt="会社ロゴ"
              width={180}
              height={180}
              className="h-auto w-40 md:w-44 drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]"
              priority
            />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white tracking-wider">
            Factory Materials
          </h1>
          <h2 className="text-2xl md:text-3xl font-bold">
            <span className="inline-block text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 drop-shadow-lg">
              在庫管理システム
            </span>
          </h2>
          <p className="text-gray-300 mt-6 text-lg">
            製品ラベルにQRコードを印刷し、スマートフォンで読み取って在庫管理を行います。
          </p>
        </div>

        {/* スマホ操作（最優先） */}
        <div className="w-full max-w-4xl mb-8">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-amber-400 to-amber-300 mb-6 text-center">
            スマホ操作
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 現場操作（QRスキャン） */}
            <Link href="/stock/scan">
              <div className="group relative h-44 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-600/20 to-cyan-900/20 rounded-2xl border-2 border-cyan-400 group-hover:border-cyan-300 group-hover:shadow-[0_0_25px_rgba(34,211,238,0.6)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                  <div className="text-6xl">📱</div>
                  <h3 className="text-2xl font-bold text-cyan-300 group-hover:text-cyan-200 transition">
                    現場操作
                    <br />
                    <span className="text-base">(QRスキャン)</span>
                  </h3>
                </div>
              </div>
            </Link>

            {/* 作業日報入力 */}
            <Link href="/work-reports">
              <div className="group relative h-44 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 to-amber-900/20 rounded-2xl border-2 border-amber-400 group-hover:border-amber-300 group-hover:shadow-[0_0_25px_rgba(251,191,36,0.6)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                  <div className="relative">
                    <div className="text-6xl">📝</div>
                    {unreadCount > 0 && (
                      <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-[24px] h-6 px-2 bg-red-500 text-white text-sm font-bold rounded-full border-2 border-slate-950 shadow-lg animate-pulse">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <h3 className="text-2xl font-bold text-amber-300 group-hover:text-amber-200 transition">
                    作業日報入力
                  </h3>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* 在庫管理 */}
        <div className="w-full max-w-4xl mb-8">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-purple-400 to-pink-400 mb-6 text-center">
            在庫管理
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 入出庫管理表 */}
          <Link href="/stock/receive">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-green-600/20 to-green-900/20 rounded-2xl border-2 border-green-400 group-hover:border-green-300 group-hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">✅</div>
                <h3 className="text-xl font-bold text-green-300 group-hover:text-green-200 transition">
                  入出庫管理表
                </h3>
              </div>
            </div>
          </Link>

          {/* ③ 在庫管理ダッシュボード */}
          <Link href="/inventory">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-purple-900/20 rounded-2xl border-2 border-purple-400 group-hover:border-purple-300 group-hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">📊</div>
                <h3 className="text-xl font-bold text-purple-300 group-hover:text-purple-200 transition">
                  在庫管理ダッシュボード
                </h3>
              </div>
            </div>
          </Link>

          {/* ④ 製品登録 */}
          <Link href="/products/register">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 to-orange-900/20 rounded-2xl border-2 border-orange-400 group-hover:border-orange-300 group-hover:shadow-[0_0_20px_rgba(249,115,22,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">📝</div>
                <h3 className="text-xl font-bold text-orange-300 group-hover:text-orange-200 transition">
                  製品登録
                </h3>
              </div>
            </div>
          </Link>

          {/* ⑤ 製品ラベル印刷 */}
          <Link href="/labels/products">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-blue-900/20 rounded-2xl border-2 border-blue-400 group-hover:border-blue-300 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">📄</div>
                <h3 className="text-xl font-bold text-blue-300 group-hover:text-blue-200 transition">
                  製品ラベル印刷
                </h3>
              </div>
            </div>
          </Link>

          {/* ⑥ 製品データインポート */}
          <Link href="/products/import">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-600/20 to-pink-900/20 rounded-2xl border-2 border-pink-400 group-hover:border-pink-300 group-hover:shadow-[0_0_20px_rgba(236,72,153,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">📥</div>
                <h3 className="text-xl font-bold text-pink-300 group-hover:text-pink-200 transition">
                  製品データインポート
                </h3>
              </div>
            </div>
          </Link>

          {/* ⑦ 製品マスタ */}
          <Link href="/products">
            <div className="group relative h-40 cursor-pointer">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/20 to-yellow-900/20 rounded-2xl border-2 border-yellow-400 group-hover:border-yellow-300 group-hover:shadow-[0_0_20px_rgba(250,204,21,0.5)] transition-all duration-300" />
              <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-3">
                <div className="text-5xl">⚙️</div>
                <h3 className="text-xl font-bold text-yellow-300 group-hover:text-yellow-200 transition">
                  製品マスタ
                </h3>
              </div>
            </div>
          </Link>
          </div>
        </div>

        {/* 製造計画・原価セクション */}
        <div className="w-full max-w-4xl mb-12">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 mb-6 text-center">
            製造計画・原価
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* 製造計画・原価管理 */}
            <Link href="/heater/manufacturing-plan">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-red-600/20 to-red-900/20 rounded-2xl border-2 border-red-400 group-hover:border-red-300 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📋</div>
                  <h3 className="text-lg font-bold text-red-300 group-hover:text-red-200 transition">
                    製造計画
                  </h3>
                </div>
              </div>
            </Link>

            {/* 製造計画配分計算 */}
            <Link href="/manufacturing-plan-allocation">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-600/20 to-pink-900/20 rounded-2xl border-2 border-pink-400 group-hover:border-pink-300 group-hover:shadow-[0_0_20px_rgba(236,72,153,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📊</div>
                  <h3 className="text-lg font-bold text-pink-300 group-hover:text-pink-200 transition">
                    配分計算
                  </h3>
                </div>
              </div>
            </Link>

            {/* 原価計算 */}
            <Link href="/work-orders/cost">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-red-600/20 to-red-900/20 rounded-2xl border-2 border-red-400 group-hover:border-red-300 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">💰</div>
                  <h3 className="text-lg font-bold text-red-300 group-hover:text-red-200 transition">
                    原価計算
                  </h3>
                </div>
              </div>
            </Link>

            {/* 原価帳票印刷 */}
            <Link href="/work-orders/cost-reports">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 rounded-2xl border-2 border-emerald-400 group-hover:border-emerald-300 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🖨️</div>
                  <h3 className="text-lg font-bold text-emerald-300 group-hover:text-emerald-200 transition">
                    原価帳票印刷
                  </h3>
                </div>
              </div>
            </Link>

            {/* 機種マスタ */}
            <Link href="/heater/models">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/20 to-yellow-900/20 rounded-2xl border-2 border-yellow-400 group-hover:border-yellow-300 group-hover:shadow-[0_0_20px_rgba(250,204,21,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🏭</div>
                  <h3 className="text-lg font-bold text-yellow-300 group-hover:text-yellow-200 transition">
                    機種マスタ
                  </h3>
                </div>
              </div>
            </Link>

            {/* 工程管理表 */}
            <Link href="/process-management">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-violet-900/20 rounded-2xl border-2 border-indigo-400 group-hover:border-indigo-300 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📈</div>
                  <h3 className="text-lg font-bold text-indigo-300 group-hover:text-indigo-200 transition">
                    工程管理表
                  </h3>
                </div>
              </div>
            </Link>

            {/* D指令原価BOM */}
            <Link href="/heater/models/dr8008">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-600/30 to-orange-900/30 rounded-2xl border-2 border-amber-400 group-hover:border-amber-300 group-hover:shadow-[0_0_20px_rgba(251,191,36,0.6)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-3xl">🔢</div>
                  <h3 className="text-base font-bold text-amber-300 group-hover:text-amber-200 transition">
                    D指令原価BOM
                  </h3>
                </div>
              </div>
            </Link>

            {/* パーツリスト */}
            <Link href="/heater/parts-master">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-600/20 to-amber-900/20 rounded-2xl border-2 border-amber-400 group-hover:border-amber-300 group-hover:shadow-[0_0_20px_rgba(217,119,6,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🔧</div>
                  <h3 className="text-lg font-bold text-amber-300 group-hover:text-amber-200 transition">
                    パーツリスト
                  </h3>
                </div>
              </div>
            </Link>

            {/* 構成部品（BOM） */}
            <Link href="/heater/bom">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 to-orange-900/20 rounded-2xl border-2 border-orange-400 group-hover:border-orange-300 group-hover:shadow-[0_0_20px_rgba(234,88,12,0.5)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🏗️</div>
                  <h3 className="text-lg font-bold text-orange-300 group-hover:text-orange-200 transition">
                    構成部品(BOM)
                  </h3>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* 日報・マスタセクション */}
        <div className="w-full max-w-5xl mb-12">
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300 mb-6 text-center">
            日報・マスタ
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link href="/staffs">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 rounded-2xl border-2 border-emerald-400 group-hover:border-emerald-300 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🧑‍🏭</div>
                  <h3 className="text-lg font-bold text-emerald-300 group-hover:text-emerald-200 transition">
                    スタッフマスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/lines">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-600/20 to-sky-900/20 rounded-2xl border-2 border-sky-400 group-hover:border-sky-300 group-hover:shadow-[0_0_20px_rgba(56,189,248,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🧭</div>
                  <h3 className="text-lg font-bold text-sky-300 group-hover:text-sky-200 transition">
                    L指令マスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/work-reports/summary">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-600/20 to-teal-900/20 rounded-2xl border-2 border-teal-400 group-hover:border-teal-300 group-hover:shadow-[0_0_20px_rgba(20,184,166,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📈</div>
                  <h3 className="text-lg font-bold text-teal-300 group-hover:text-teal-200 transition">
                    日報集計
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/notifications/send">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-blue-900/20 rounded-2xl border-2 border-blue-400 group-hover:border-blue-300 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🔔</div>
                  <h3 className="text-lg font-bold text-blue-300 group-hover:text-blue-200 transition">
                    通知送信管理
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/work-orders">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-indigo-900/20 rounded-2xl border-2 border-indigo-400 group-hover:border-indigo-300 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📋</div>
                  <h3 className="text-lg font-bold text-indigo-300 group-hover:text-indigo-200 transition">
                    D指令マスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/machines">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-blue-900/20 rounded-2xl border-2 border-blue-400 group-hover:border-blue-300 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">⚙️</div>
                  <h3 className="text-lg font-bold text-blue-300 group-hover:text-blue-200 transition">
                    機械設備分類マスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/work-group-master">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/20 to-indigo-900/20 rounded-2xl border-2 border-indigo-500 group-hover:border-indigo-400 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">👥</div>
                  <h3 className="text-lg font-bold text-indigo-300 group-hover:text-indigo-200 transition">
                    作業グループマスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/work-contents">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-600/20 to-orange-900/20 rounded-2xl border-2 border-orange-400 group-hover:border-orange-300 group-hover:shadow-[0_0_20px_rgba(249,115,22,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">🧩</div>
                  <h3 className="text-lg font-bold text-orange-300 group-hover:text-orange-200 transition">
                    作業内容マスタ
                  </h3>
                </div>
              </div>
            </Link>

            <Link href="/masters/import">
              <div className="group relative h-32 cursor-pointer">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-purple-900/20 rounded-2xl border-2 border-purple-400 group-hover:border-purple-300 group-hover:shadow-[0_0_20px_rgba(168,85,247,0.45)] transition-all duration-300" />
                <div className="relative h-full flex flex-col items-center justify-center p-6 space-y-2">
                  <div className="text-4xl">📥</div>
                  <h3 className="text-lg font-bold text-purple-300 group-hover:text-purple-200 transition">
                    マスタCSV取込
                  </h3>
                </div>
              </div>
            </Link>
          </div>
        </div>
        <div className="text-center text-gray-500 text-sm mt-8">
          <p>© 2026 Factory Materials Inventory System</p>
        </div>
      </div>

      {/* アニメーション用スタイル */}
      <style jsx>{`
        @keyframes glow {
          0%, 100% {
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
          }
          50% {
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.6);
          }
        }
      `}</style>
    </div>
  );
}
