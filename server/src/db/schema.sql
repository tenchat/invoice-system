-- 数电发票系统 SQLite 表结构
-- 金额统一用 REAL（分以下精度由前端 2 位小数约束），时间统一用本地时间字符串 YYYY-MM-DD HH:MM:SS
PRAGMA foreign_keys = ON;

-- 用户：学生（学号唯一）与管理员共用一张表
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  role           TEXT    NOT NULL CHECK (role IN ('student', 'admin')),
  name           TEXT    NOT NULL,               -- 学生姓名 / 管理员显示名
  student_id     TEXT,                          -- 学号，学生必填且唯一
  username       TEXT,                          -- 管理员登录名
  password_hash  TEXT,
  deleted_at     TEXT,
  auth_version   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  last_login_at  TEXT
);

-- 上传文件：原件与预览图分离；拼版 PDF 直接使用原件
CREATE TABLE IF NOT EXISTS files (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  original_name    TEXT NOT NULL,
  stored_name      TEXT NOT NULL UNIQUE,       -- 随机名，杜绝路径穿越
  rel_path         TEXT NOT NULL,              -- 相对 uploadsDir
  preview_rel_path TEXT,                       -- 相对 uploadsDir 的 PNG
  mime             TEXT NOT NULL,
  detected_type    TEXT NOT NULL CHECK (detected_type IN ('xml','pdf','jpg','png')),
  size             INTEGER NOT NULL,
  sha256           TEXT NOT NULL,
  uploaded_by      INTEGER NOT NULL,
  recognized_total REAL,
  bound            INTEGER NOT NULL DEFAULT 0, -- 是否已关联发票（未关联的定时/手工清理）
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);

-- 发票主表
CREATE TABLE IF NOT EXISTS invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  file_id           INTEGER,
  invoice_number    TEXT NOT NULL UNIQUE,      -- 20 位数电票号码，查重键
  issue_date        TEXT,                      -- YYYY-MM-DD
  buyer_name        TEXT,
  buyer_tax_id      TEXT,
  seller_name       TEXT,
  seller_tax_id     TEXT,
  amount_excl_tax   REAL,                      -- 合计金额（不含税）
  total_tax         REAL,                      -- 合计税额
  amount_incl_tax   REAL,                      -- 价税合计
  remark            TEXT,
  fund_purpose      TEXT,
  scan_status       INTEGER NOT NULL DEFAULT 0,
  reimbursed        INTEGER NOT NULL DEFAULT 0,     -- 管理员标记是否已报销
  field_sources     TEXT NOT NULL DEFAULT '{}',-- JSON: { "invoice": {...}, "items": [ {...} ] }
  warnings          TEXT NOT NULL DEFAULT '[]',-- JSON: 校验/二维码不一致警告
  parse_status      TEXT NOT NULL DEFAULT 'manual', -- xml|pdf|qr|ocr|manual|failed|mixed
  locked            INTEGER NOT NULL DEFAULT 0,     -- 管理员锁定
  print_status      INTEGER NOT NULL DEFAULT 0,     -- 0 未打印 / 1 已打印
  print_batch_id    INTEGER,
  printed_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (file_id) REFERENCES files(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_user    ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_date    ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_print   ON invoices(print_status);
CREATE INDEX IF NOT EXISTS idx_inv_created ON invoices(created_at);

-- 发票明细（一对多）
CREATE TABLE IF NOT EXISTS invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  name          TEXT,                          -- 项目名称
  spec          TEXT,                          -- 规格型号
  unit          TEXT,                          -- 单位
  quantity      REAL,
  unit_price    REAL,
  amount        REAL,
  tax_rate      TEXT,                          -- 税率，如 13% / 免税
  tax_amount    REAL,
  field_sources TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);

-- 打印批次
CREATE TABLE IF NOT EXISTS print_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id   INTEGER NOT NULL,
  operator_name TEXT NOT NULL,
  count         INTEGER NOT NULL,
  layout        TEXT NOT NULL,                 -- JSON 版式参数（含发票 id 列表，供重新打印）
  action        TEXT NOT NULL DEFAULT 'print', -- print | export | mark
  undone        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  undone_at     TEXT
);

CREATE TABLE IF NOT EXISTS print_batch_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          INTEGER NOT NULL,
  invoice_id        INTEGER NOT NULL,
  prev_print_status INTEGER NOT NULL DEFAULT 0, -- 撤销时恢复到此状态
  UNIQUE (batch_id, invoice_id),
  FOREIGN KEY (batch_id)   REFERENCES print_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- 操作日志：所有状态变更可追溯
CREATE TABLE IF NOT EXISTS operation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  actor_name  TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,                            -- JSON
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON operation_logs(created_at);

CREATE TABLE IF NOT EXISTS invoice_amount_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  purpose_threshold REAL NOT NULL DEFAULT 200,
  max_amount REAL
);

CREATE TABLE IF NOT EXISTS budget_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  budget_limit REAL NOT NULL
);
