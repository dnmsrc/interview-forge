export const SCHEMA_VERSION = 7

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
    note TEXT,
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
  )`,
  // ---------- R9 自适应摸底：沿前置链探针，会话与每轮判定持久化、可断点续测 ----------
  `CREATE TABLE IF NOT EXISTS placement_session (
    id TEXT PRIMARY KEY, domain TEXT, status TEXT DEFAULT 'active',
    current_node_id TEXT, level REAL DEFAULT 2,
    created_at TEXT, updated_at TEXT, finished_at TEXT, summary TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS placement_turn (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    node_id TEXT, question_id TEXT, scale4 INTEGER, pct REAL, verdict TEXT,
    gap_type TEXT, gap_note TEXT, grading_kind TEXT, answer TEXT, created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pturn_session ON placement_turn(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_psession_domain ON placement_session(domain, status)`,

  // ---------- 知识体系（见 docs/design/KNOWLEDGE-SYSTEM.md §2）----------
  // 正文以 content/knowledge/<id>.md 为源，本表是其索引；search_text 由服务写入时生成
  // （CJK 走 2-gram + 拉丁词），因为 FTS5 的 unicode61 不分中文词，trigram 又要求查询词 ≥3 字，
  // 「路由」「闭包」这类两字术语会搜不到。
  `CREATE TABLE IF NOT EXISTS knowledge (
    node_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    body_md TEXT NOT NULL, summary TEXT, search_text TEXT DEFAULT '',
    hash TEXT NOT NULL, confidence TEXT DEFAULT 'medium', reviewed INTEGER DEFAULT 0,
    generator TEXT, word_count INTEGER DEFAULT 0, quality_flags TEXT,
    updated_at TEXT, indexed_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_conf ON knowledge(confidence)`,
  `CREATE TABLE IF NOT EXISTS knowledge_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL,
    url TEXT NOT NULL, title TEXT, kind TEXT, fetched_at TEXT, trust REAL DEFAULT 0.5,
    snippet TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ks_node ON knowledge_sources(node_id)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    title, summary, search_text, content='knowledge', content_rowid='rowid', tokenize='unicode61'
  )`,
  // external-content 模式必须手动同步索引（三个触发器缺一不可，否则搜索结果会残留已删内容）
  `CREATE TRIGGER IF NOT EXISTS trg_kfts_ins AFTER INSERT ON knowledge BEGIN
     INSERT INTO knowledge_fts(rowid,title,summary,search_text) VALUES(new.rowid,new.title,new.summary,new.search_text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_kfts_upd AFTER UPDATE OF title,summary,search_text,body_md ON knowledge BEGIN
     INSERT INTO knowledge_fts(knowledge_fts,rowid,title,summary,search_text) VALUES('delete',old.rowid,old.title,old.summary,old.search_text);
     INSERT INTO knowledge_fts(rowid,title,summary,search_text) VALUES(new.rowid,new.title,new.summary,new.search_text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_kfts_del AFTER DELETE ON knowledge BEGIN
     INSERT INTO knowledge_fts(knowledge_fts,rowid,title,summary,search_text) VALUES('delete',old.rowid,old.title,old.summary,old.search_text);
   END`,
  // ---------- R25 题目检索索引（私教答疑的事实来源）----------
  // questions.data 是一整列 JSON，没法做字段级加权。凡是「讲解某道题」的场景，都要能把
  // 这道题自己的标准解析 / 易漏点抓出来当事实依据，否则小模型只能凭记忆瞎讲。
  // 因此把题目抽成一张**派生表**（content/ 的可重建缓存，不是用户数据），五个字段各自分词后
  // 交给 FTS5 做字段级 bm25 加权；原文留在本表，检索时 JOIN 回去。
  // 分词口径与 knowledge 完全一致（shared/question-index-core.mjs → tokenizeForSearch）。
  `CREATE TABLE IF NOT EXISTS question_index (
    qid TEXT PRIMARY KEY, node_id TEXT NOT NULL,
    stem TEXT NOT NULL DEFAULT '', analysis TEXT DEFAULT '', gap_check TEXT DEFAULT '',
    answer_text TEXT DEFAULT '', tags_text TEXT DEFAULT '',
    stem_tk TEXT DEFAULT '', analysis_tk TEXT DEFAULT '', gap_tk TEXT DEFAULT '',
    answer_tk TEXT DEFAULT '', tags_tk TEXT DEFAULT '',
    indexed_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qidx_node ON question_index(node_id)`,
  // 列顺序必须与 shared/question-index-core.mjs 的 QIDX_COLUMNS / QIDX_WEIGHTS 严格一致：
  // stem 12（题干是主题词的来源）/ analysis 6（语义主体）/ tags 4（主题标签）
  // / gap 3（易漏点，讲「容易错在哪」时最有价值）/ answer 2（标准答案，短且多为符号）
  `CREATE VIRTUAL TABLE IF NOT EXISTS question_fts USING fts5(
    stem_tk, analysis_tk, gap_tk, answer_tk, tags_tk,
    content='question_index', content_rowid='rowid', tokenize='unicode61'
  )`,
  `CREATE TRIGGER IF NOT EXISTS trg_qidx_ins AFTER INSERT ON question_index BEGIN
     INSERT INTO question_fts(rowid,stem_tk,analysis_tk,gap_tk,answer_tk,tags_tk)
     VALUES(new.rowid,new.stem_tk,new.analysis_tk,new.gap_tk,new.answer_tk,new.tags_tk);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_qidx_upd AFTER UPDATE OF stem_tk,analysis_tk,gap_tk,answer_tk,tags_tk ON question_index BEGIN
     INSERT INTO question_fts(question_fts,rowid,stem_tk,analysis_tk,gap_tk,answer_tk,tags_tk) VALUES('delete',old.rowid,old.stem_tk,old.analysis_tk,old.gap_tk,old.answer_tk,old.tags_tk);
     INSERT INTO question_fts(rowid,stem_tk,analysis_tk,gap_tk,answer_tk,tags_tk) VALUES(new.rowid,new.stem_tk,new.analysis_tk,new.gap_tk,new.answer_tk,new.tags_tk);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_qidx_del AFTER DELETE ON question_index BEGIN
     INSERT INTO question_fts(question_fts,rowid,stem_tk,analysis_tk,gap_tk,answer_tk,tags_tk) VALUES('delete',old.rowid,old.stem_tk,old.analysis_tk,old.gap_tk,old.answer_tk,old.tags_tk);
   END`,
  // ---------- R20 游戏化：XP/等级、连续打卡、徽章墙（全部是用户数据，只增不删） ----------
  // 单行存档：累计 XP、等级快照、连续/最长打卡、每日 XP、答题计数。等级由 XP 纯函数推导，
  // level 列只作快照便于面板直接读，权威等级以 shared/game.ts 的 levelForXp 为准。
  `CREATE TABLE IF NOT EXISTS game_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_active_day TEXT,
    answered_total INTEGER NOT NULL DEFAULT 0,
    perfect_total INTEGER NOT NULL DEFAULT 0,
    chapters_cleared INTEGER NOT NULL DEFAULT 0,
    bosses_beaten INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`,
  // 徽章墙：每个徽章一行，解锁幂等（UNIQUE badge_id），解锁时记录当时进度快照
  `CREATE TABLE IF NOT EXISTS game_badges (
    badge_id TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    xp_snapshot INTEGER NOT NULL DEFAULT 0,
    meta TEXT
  )`,
  // 庆祝事件流：每次作答/通关产生的 XP 增量、升级、徽章、Boss、章节通关都落一行，
  // 前端拉「未读事件」弹庆祝；读过即置 read=1。重开应用也不会丢尚未展示的奖励。
  `CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT,
    ref_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gevents_unread ON game_events(read, id)`,

  // AI 通俗解析，兼当缓存：同 (node_id, ask, style) 直接复用，别重复烧 token
  `CREATE TABLE IF NOT EXISTS ai_explain (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL, ask TEXT NOT NULL,
    style TEXT NOT NULL DEFAULT 'easier', model TEXT, tokens INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
    answer_md TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_explain_lookup ON ai_explain(node_id, ask, style)`
]

/**
 * 老库升级用的加列语句。SQLite 没有 ADD COLUMN IF NOT EXISTS，重复执行会抛
 * "duplicate column name"，所以调用方必须逐条 try/catch 只容忍这一种错误（见 db.ts）。
 */
export const MIGRATION_STATEMENTS = [
  // 掌握状态机（KNOWLEDGE-SYSTEM.md §7）：点亮只是第一步，反复练习才算掌握，忘记要降级
  `ALTER TABLE node_mastery ADD COLUMN mastery_level INTEGER DEFAULT 0`,
  `ALTER TABLE node_mastery ADD COLUMN pass_reps INTEGER DEFAULT 0`,
  `ALTER TABLE node_mastery ADD COLUMN total_reps INTEGER DEFAULT 0`,
  `ALTER TABLE node_mastery ADD COLUMN lapses INTEGER DEFAULT 0`,
  `ALTER TABLE node_mastery ADD COLUMN next_review TEXT`,
  `ALTER TABLE node_mastery ADD COLUMN retention REAL DEFAULT 0`,
  `ALTER TABLE node_mastery ADD COLUMN stale INTEGER DEFAULT 0`,
  // R15 摸底续测回看：把每轮用户答案随 turn 持久化，退出再进才能还原「我当时答了什么」
  // （旧库该列不存在，靠这里的 ALTER 自动补；重复执行的 duplicate column 由 db.ts 容忍）
  `ALTER TABLE placement_turn ADD COLUMN answer TEXT`,
  // R19 关系本体：9 类语义边的「为什么有这层关系」一句话说明（见 shared/relations.ts）
  `ALTER TABLE edges ADD COLUMN note TEXT`
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
