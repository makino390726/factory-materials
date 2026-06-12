'use client'

import { useEffect, useState } from 'react'

type NotificationPermission = 'default' | 'granted' | 'denied'

type Props = {
  staffId: string
  enabled?: boolean
  checkInterval?: number // ミリ秒
}

export default function PushNotificationManager({ 
  staffId, 
  enabled = true,
  checkInterval = 30000 // 30秒ごと
}: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [lastCheckTime, setLastCheckTime] = useState<number>(Date.now())

  // 通知許可をリクエスト
  useEffect(() => {
    if (!enabled || !('Notification' in window)) return

    // 現在の許可状態を取得
    setPermission(Notification.permission as NotificationPermission)

    // デフォルト状態なら許可をリクエスト
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((result) => {
        setPermission(result as NotificationPermission)
      })
    }
  }, [enabled])

  // 定期的に未読通知をチェック
  useEffect(() => {
    if (!enabled || !staffId || permission !== 'granted') return

    const checkNotifications = async () => {
      try {
        const response = await fetch(`/api/notifications?staff_id=${staffId}&unread_only=true`)
        if (!response.ok) return

        const data = await response.json()
        const notifications = data.notifications || []

        // 最後のチェック以降に作成された通知のみを表示
        const newNotifications = notifications.filter((n: any) => {
          const createdAt = new Date(n.created_at).getTime()
          return createdAt > lastCheckTime
        })

        // 新しい通知があればブラウザ通知を表示
        newNotifications.forEach((notification: any) => {
          showBrowserNotification(notification)
        })

        if (newNotifications.length > 0) {
          setLastCheckTime(Date.now())
        }
      } catch (error) {
        console.error('Failed to check notifications:', error)
      }
    }

    // 初回チェック
    checkNotifications()

    // 定期的にチェック
    const interval = setInterval(checkNotifications, checkInterval)

    return () => clearInterval(interval)
  }, [staffId, enabled, permission, checkInterval, lastCheckTime])

  const showBrowserNotification = (notification: any) => {
    if (Notification.permission !== 'granted') return

    const title = getNotificationTitle(notification.notification_type)
    const options: NotificationOptions = {
      body: notification.message,
      icon: '/company-logo.png',
      badge: '/company-logo.png',
      tag: `notification-${notification.id}`,
      requireInteraction: true, // クリックするまで表示し続ける
    }

    const browserNotification = new Notification(title, options)

    // 通知をクリックしたら日報入力画面を開く
    browserNotification.onclick = () => {
      window.focus()
      window.location.href = '/work-reports'
      browserNotification.close()
    }

    // 5秒後に自動で閉じる（requireInteractionがfalseの場合）
    // setTimeout(() => browserNotification.close(), 5000)
  }

  const getNotificationTitle = (type: string): string => {
    switch (type) {
      case 'work_report_reminder':
        return '📝 日報入力のお願い'
      case 'announcement':
        return '📢 お知らせ'
      case 'info':
        return 'ℹ️ 情報'
      default:
        return '🔔 通知'
    }
  }

  // UIは表示しない（バックグラウンドで動作）
  return null
}
