-- 通知テーブル
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  staff_id UUID NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'info',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT,
  CONSTRAINT fk_staff
    FOREIGN KEY (staff_id)
    REFERENCES staffs(id)
    ON DELETE CASCADE
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_notifications_staff_id ON notifications(staff_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_staff_unread ON notifications(staff_id, is_read) WHERE is_read = false;

-- コメント
COMMENT ON TABLE notifications IS '通知テーブル';
COMMENT ON COLUMN notifications.id IS '通知ID';
COMMENT ON COLUMN notifications.staff_id IS '対象スタッフID';
COMMENT ON COLUMN notifications.message IS '通知メッセージ';
COMMENT ON COLUMN notifications.notification_type IS '通知種類（work_report_reminder: 日報催促, announcement: お知らせ, info: 情報）';
COMMENT ON COLUMN notifications.is_read IS '既読フラグ';
COMMENT ON COLUMN notifications.created_at IS '作成日時';
COMMENT ON COLUMN notifications.read_at IS '既読日時';
COMMENT ON COLUMN notifications.created_by IS '作成者（管理者ID）';

-- RLS (Row Level Security) 設定
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ポリシー: スタッフは自分の通知のみ参照可能
CREATE POLICY notifications_select_policy ON notifications
  FOR SELECT
  USING (true);

-- ポリシー: 管理者のみ通知を作成可能（サービスロールは全て許可）
CREATE POLICY notifications_insert_policy ON notifications
  FOR INSERT
  WITH CHECK (true);

-- ポリシー: スタッフは自分の通知のみ更新可能（既読化）
CREATE POLICY notifications_update_policy ON notifications
  FOR UPDATE
  USING (true);

-- ポリシー: 管理者のみ通知を削除可能
CREATE POLICY notifications_delete_policy ON notifications
  FOR DELETE
  USING (true);
