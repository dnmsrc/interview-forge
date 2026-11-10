export const SCHEMA_VERSION = 2

/** 全部建表语句。Electron 主进程与 scripts/*.mjs 共用这一份，避免两套 schema。 */
export const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT )`,

  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY, parent TEXT, title TEXT NOT NULL, level INTEGER NOT NULL,
    domain TEXT, stack TEXT, topic TEXT, summary TEXT, est_minutes INTEGER DEFAULT 0,
    must_master INTEGER DEFAULT 0, threshold INTEGER DEFAULT 2,
    locked_by_default INTEGER DEFAULT 0, ord INTEGER DEFAULT 0, status TEXT DEFAULT 'active'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_domain ON nodes(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_level ON nodes(level)`,

  `CREATE TABLE IF NOT EXISTS edges (
    from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL, weight REAL DEFAULT 1,
    PRIMARY KEY (from_id, to_id, type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`,

  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY, node_id TEXT NOT NULL, parent_id TEXT, angle TEXT,
    type TEXT NOT NULL, difficulty INTEGER NOT NULL, data TEXT NOT NULL,
    status TEXT DEFAULT 'active', open_book INTEGER DEFAULT 1,
    source_kind TEXT, tags TEXT, created_at TEXT, updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_q_node ON questions(node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_q_type ON questions(type)`,
  `CREATE INDEX IF NOT EXISTS idx_q_status ON questions(status)`,

  `CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL, exam_id TEXT, mode TEXT NOT NULL,
    answer TEXT, score REAL, scale4 INTEGER,
    grading_kind TEXT, ai_model TEXT, tokens INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
    wrong_points TEXT, feedback TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_att_q ON attempts(question_id)`,
  `CREATE INDEX IF NOT EXISTS idx_att_exam ON attempts(exam_id)`,

  `CREATE TABLE IF NOT EXISTS srs (
    question_id TEXT PRIMARY KEY,
    stability REAL DEFAULT 0, difficulty REAL DEFAULT 0,
    reps INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0, state INTEGER DEFAULT 0,
    due TEXT, last_review TEXT, avg_score REAL DEFAULT 0, weight REAL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_srs_due ON srs(due)`,

  `CREATE TABLE IF NOT EXISTS node_mastery (
    node_id TEXT PRIMARY KEY,
    scale4 REAL DEFAULT 0, lit INTEGER DEFAULT 0, needs_work INTEGER DEFAULT 0,
    answered INTEGER DEFAULT 0, correct INTEGER DEFAULT 0,
    forced_unlock INTEGER DEFAULT 0, last_practice TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY, title TEXT, spec TEXT,
    started_at TEXT, deadline_at TEXT, submitted_at TEXT,
    paused_ms INTEGER DEFAULT 0, status TEXT NOT NULL,
    total REAL, pass_line REAL DEFAULT 60, self_est REAL,
    ai_report TEXT, model TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS exam_questions (
    exam_id TEXT NOT NULL, qid TEXT NOT NULL, ord INTEGER, answer TEXT, self_est REAL,
    PRIMARY KEY (exam_id, qid)
  )`,

  `CREATE TABLE IF NOT EXISTS bank_versions (
    id TEXT PRIMARY KEY, created_at TEXT, kind TEXT,
    added INTEGER DEFAULT 0, revised INTEGER DEFAULT 0, retired INTEGER DEFAULT 0,
    report TEXT, dir TEXT, rolled_back INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS dirty_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, reason TEXT, user_edit TEXT,
    ai_action TEXT, ai_result TEXT, status TEXT DEFAULT 'open', created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ai_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, task TEXT, model TEXT,
    in_tokens INTEGER DEFAULT 0, out_tokens INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
    ref_type TEXT, ref_id TEXT, ok INTEGER DEFAULT 1, note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT )`,
  `CREATE TABLE IF NOT EXISTS checkins ( day TEXT PRIMARY KEY, done INTEGER DEFAULT 0, plan TEXT )`,
  `CREATE TABLE IF NOT EXISTS placement (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, scale4 REAL, pct REAL,
    detail TEXT, created_at TEXT
  )`
]

export const SUBJECTIVE_TYPES = new Set(['short', 'essay', 'code'])
export const ALL_QUESTION_TYPES = ['single', 'multiple', 'judge', 'blank', 'short', 'essay', 'code']

/** 内部四档 → 百分制区间（需求规格 §5） */
export function scale4ToPct(scale4, partial = 1) {
  const bands = [[0, 25], [26, 55], [56, 80], [81, 100]]
  const s = Math.max(0, Math.min(3, Math.round(scale4)))
  const [lo, hi] = bands[s]
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, partial)))
}
