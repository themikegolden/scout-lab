CREATE TABLE IF NOT EXISTS feed_snapshots_v21 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed TEXT NOT NULL CHECK (feed IN ('candidates','emails')),
  run_id TEXT,
  source TEXT NOT NULL,
  source_timestamp TEXT,
  researched_at TEXT,
  published_at TEXT NOT NULL,
  checked_at TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  records_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_snapshots_v21_feed_id ON feed_snapshots_v21(feed, id DESC);
CREATE INDEX IF NOT EXISTS idx_feed_snapshots_v21_run ON feed_snapshots_v21(run_id);

CREATE TABLE IF NOT EXISTS task_runs_v21 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  trigger TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  requested_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  checked_at TEXT,
  source_timestamp TEXT,
  records_checked INTEGER NOT NULL DEFAULT 0,
  records_added INTEGER NOT NULL DEFAULT 0,
  records_changed INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  agent_trigger_run_id TEXT,
  conversation_url TEXT,
  publish_nonce_hash TEXT,
  publish_nonce_expires_at TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_v21_started ON task_runs_v21(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_v21_kind_status ON task_runs_v21(kind, status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_v21_agent_run ON task_runs_v21(agent_trigger_run_id) WHERE agent_trigger_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ig_leads (
  normalized_handle TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  name TEXT,
  tag TEXT,
  detail TEXT,
  note TEXT,
  source_url TEXT,
  profile_url TEXT,
  followers TEXT,
  account_type TEXT,
  contact_url TEXT,
  evidence TEXT,
  pipeline_stage TEXT NOT NULL DEFAULT 'New' CHECK (pipeline_stage IN ('New','Review','Shortlist','Contacted','Outcome')),
  product_fit TEXT,
  estimated_collab_cost TEXT,
  notes TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source_timestamp TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ig_leads_stage ON ig_leads(pipeline_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_leads_seen ON ig_leads(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS mail_messages (
  message_key TEXT PRIMARY KEY,
  gmail_message_id TEXT,
  subject TEXT NOT NULL,
  sender TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source_timestamp TEXT,
  run_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_received ON mail_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_run ON mail_messages(run_id);

CREATE TABLE IF NOT EXISTS store_health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  orders_count INTEGER,
  orders_updated_at TEXT,
  payment_issues_json TEXT NOT NULL DEFAULT '[]',
  app_alerts_json TEXT NOT NULL DEFAULT '[]',
  researched_at TEXT,
  published_at TEXT NOT NULL,
  checked_at TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_health_published ON store_health_snapshots(published_at DESC);