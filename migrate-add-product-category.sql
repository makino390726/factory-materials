-- 機種マスタ・製造計画に製品カテゴリを追加
-- 暖房機以外（たばこ乾燥機・食品乾燥機・光合成促進装置など）の生産計画に対応

ALTER TABLE heater_models
  ADD COLUMN IF NOT EXISTS product_category TEXT NOT NULL DEFAULT '暖房機';

ALTER TABLE heater_manufacturing_plans
  ADD COLUMN IF NOT EXISTS product_category TEXT NOT NULL DEFAULT '暖房機';

CREATE INDEX IF NOT EXISTS idx_heater_models_product_category
  ON heater_models(product_category);

CREATE INDEX IF NOT EXISTS idx_heater_manufacturing_plans_product_category
  ON heater_manufacturing_plans(product_category);

COMMENT ON COLUMN heater_models.product_category IS '製品カテゴリ（暖房機 / たばこ乾燥機 / 食品乾燥機 / 光合成促進装置 / 作業器機 / その他）';
COMMENT ON COLUMN heater_manufacturing_plans.product_category IS '計画の主製品カテゴリ';
COMMENT ON TABLE heater_manufacturing_plans IS '製造計画マスター（暖房機・乾燥機・光合成促進装置など）';
