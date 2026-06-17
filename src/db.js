'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.mediaDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    media_path TEXT NOT NULL,
    media_type TEXT NOT NULL,           -- 'photo' | 'video'
    platforms TEXT NOT NULL,            -- JSON-массив id площадок
    caption TEXT,
    publish_at INTEGER NOT NULL,        -- unix ms
    status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
    result TEXT,                        -- JSON с результатом по площадкам
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status_time ON jobs(status, publish_at);
`);

/**
 * Создаёт задание на публикацию.
 * @param {Object} job
 * @param {string|number} job.userId
 * @param {string|number} job.chatId
 * @param {string} job.mediaPath абсолютный путь к файлу
 * @param {'photo'|'video'} job.mediaType
 * @param {string[]} job.platforms id площадок
 * @param {string} [job.caption]
 * @param {number} job.publishAt unix ms
 * @returns {number} id задания
 */
function createJob({ userId, chatId, mediaPath, mediaType, platforms, caption, publishAt }) {
  const stmt = db.prepare(`
    INSERT INTO jobs (user_id, chat_id, media_path, media_type, platforms, caption, publish_at, status, created_at)
    VALUES (@user_id, @chat_id, @media_path, @media_type, @platforms, @caption, @publish_at, 'pending', @created_at)
  `);
  const info = stmt.run({
    user_id: String(userId),
    chat_id: String(chatId),
    media_path: mediaPath,
    media_type: mediaType,
    platforms: JSON.stringify(platforms),
    caption: caption || null,
    publish_at: publishAt,
    created_at: Date.now(),
  });
  return Number(info.lastInsertRowid);
}

/**
 * Возвращает задания, готовые к публикации (status=pending и время наступило).
 * @param {number} now unix ms
 * @returns {Array<Object>} задания с распарсенными platforms
 */
function getDueJobs(now = Date.now()) {
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE status = 'pending' AND publish_at <= ? ORDER BY publish_at ASC`)
    .all(now);
  return rows.map(hydrate);
}

function getJob(id) {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  return row ? hydrate(row) : null;
}

/**
 * Атомарно помечает задание как processing, только если оно ещё pending.
 * @returns {boolean} удалось ли захватить задание
 */
function claimJob(id) {
  const info = db
    .prepare(`UPDATE jobs SET status = 'processing' WHERE id = ? AND status = 'pending'`)
    .run(id);
  return info.changes === 1;
}

/**
 * Обновляет статус задания и сохраняет результат.
 * @param {number} id
 * @param {'pending'|'processing'|'done'|'failed'} status
 * @param {Object} [result]
 */
function setStatus(id, status, result) {
  db.prepare(`UPDATE jobs SET status = ?, result = ? WHERE id = ?`).run(
    status,
    result ? JSON.stringify(result) : null,
    id,
  );
}

function hydrate(row) {
  return {
    ...row,
    platforms: JSON.parse(row.platforms),
    result: row.result ? JSON.parse(row.result) : null,
  };
}

module.exports = {
  db,
  createJob,
  getDueJobs,
  getJob,
  claimJob,
  setStatus,
};
