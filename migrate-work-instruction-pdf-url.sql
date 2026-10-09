-- 製作指図書の指令番号に、GoogleドライブのPDFリンクを持たせる
ALTER TABLE work_instruction_progress
  ADD COLUMN IF NOT EXISTS pdf_url text;

COMMENT ON COLUMN work_instruction_progress.pdf_url IS '指令書PDFのGoogleドライブURL。部品行は親の指令番号のリンクを使う';
