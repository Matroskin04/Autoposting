'use strict';

const fs = require('fs');
const cron = require('node-cron');
const db = require('./db');
const config = require('./config');

const PLATFORM_LABELS = Object.fromEntries(
  (config.PLATFORMS || []).map((p) => [p.id, p.label]),
);

function platformLabel(id) {
  return PLATFORM_LABELS[id] || id;
}

/**
 * Формирует читаемый текстовый отчёт по результатам публикации.
 * @param {Object} job
 * @param {'done'|'failed'} status
 * @param {Object} results map platformId -> { ok, info?, error? }
 * @returns {string}
 */
function buildReport(job, status, results) {
  const header = status === 'done' ? '✅ Публикация выполнена' : '⚠️ Публикация завершена с ошибками';
  const lines = [`${header} (задание #${job.id})`];

  for (const platformId of job.platforms) {
    const res = results[platformId] || { ok: false, error: 'Нет результата' };
    const mark = res.ok ? '✅' : '❌';
    let line = `${mark} ${platformLabel(platformId)}`;
    if (!res.ok && res.error) {
      line += ` — ${res.error}`;
    } else if (res.ok && res.info) {
      line += ` — ${typeof res.info === 'string' ? res.info : 'опубликовано'}`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Обрабатывает одно задание: публикует на все площадки, обновляет статус,
 * уведомляет пользователя и при успехе удаляет медиафайл.
 */
async function processJob(job, publishers, bot) {
  const results = {};

  for (const platformId of job.platforms) {
    const fn = publishers && publishers[platformId];
    if (typeof fn !== 'function') {
      results[platformId] = { ok: false, error: 'Неизвестная площадка' };
      continue;
    }

    try {
      const res = await fn({
        mediaPath: job.media_path,
        mediaType: job.media_type,
        caption: job.caption || undefined,
      });
      results[platformId] = res && typeof res === 'object'
        ? res
        : { ok: false, error: 'Некорректный ответ публикатора' };
    } catch (err) {
      results[platformId] = { ok: false, error: (err && err.message) || String(err) };
      console.error(`[scheduler] Ошибка публикации job#${job.id} на ${platformId}:`, err);
    }
  }

  const allOk = job.platforms.length > 0 && job.platforms.every((p) => results[p] && results[p].ok);
  const status = allOk ? 'done' : 'failed';

  try {
    db.setStatus(job.id, status, results);
  } catch (err) {
    console.error(`[scheduler] Не удалось обновить статус job#${job.id}:`, err);
  }

  console.log(`[scheduler] Job#${job.id} завершён со статусом '${status}'.`);

  try {
    await bot.sendMessage(job.chat_id, buildReport(job, status, results));
  } catch (err) {
    console.error(`[scheduler] Не удалось отправить уведомление по job#${job.id}:`, err);
  }

  if (status === 'done') {
    try {
      fs.unlink(job.media_path, (err) => {
        if (err) {
          console.error(`[scheduler] Не удалось удалить медиафайл job#${job.id}:`, err.message);
        }
      });
    } catch (err) {
      console.error(`[scheduler] Ошибка при удалении медиафайла job#${job.id}:`, err);
    }
  }
}

/**
 * Запускает планировщик автопостинга.
 * @param {Object} opts
 * @param {import('node-telegram-bot-api')} opts.bot экземпляр бота для уведомлений
 * @param {Object<string, function>} opts.publishers map platformId -> async ({ mediaPath, mediaType, caption }) => ({ ok, info?, error? })
 * @returns {{ stop: function }} управление задачей cron
 */
function startScheduler({ bot, publishers }) {
  let isRunning = false;

  async function tick() {
    if (isRunning) {
      console.log('[scheduler] Предыдущий tick ещё выполняется — пропускаю.');
      return;
    }
    isRunning = true;

    try {
      let jobs = [];
      try {
        jobs = db.getDueJobs();
      } catch (err) {
        console.error('[scheduler] Не удалось получить задания:', err);
        return;
      }

      if (jobs.length > 0) {
        console.log(`[scheduler] Найдено заданий к публикации: ${jobs.length}.`);
      }

      for (const job of jobs) {
        try {
          if (!db.claimJob(job.id)) {
            console.log(`[scheduler] Job#${job.id} уже взят другим обработчиком — пропуск.`);
            continue;
          }
          console.log(`[scheduler] Обрабатываю job#${job.id} (площадки: ${job.platforms.join(', ')}).`);
          await processJob(job, publishers, bot);
        } catch (err) {
          console.error(`[scheduler] Непредвиденная ошибка при обработке job#${job.id}:`, err);
        }
      }
    } finally {
      isRunning = false;
    }
  }

  const task = cron.schedule('* * * * *', tick);
  console.log('[scheduler] Планировщик запущен (cron: каждую минуту).');

  // Catch-up для пропущенных заданий после перезапуска.
  tick().catch((err) => console.error('[scheduler] Ошибка стартового tick:', err));

  return { stop: () => task.stop() };
}

module.exports = { startScheduler };
