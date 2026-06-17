'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const {
  createJob,
  getPendingJobsByChatId,
  countPendingJobsByChatId,
  deletePendingJob,
} = require('../db');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const SCHEDULE_PAGE_SIZE = 5;

const PLATFORM_SHORT = {
  vk_group: 'ВК',
  tg_personal: 'TG личная',
  tg_channel: 'TG канал',
};

const MAIN_MENU_TEXT =
  'Привет! Я помогу запланировать публикацию сторис.\n\n' +
  'Выберите действие:';

// Состояния пользователей по chatId.
// Структура: { mediaPath, mediaType, caption, platforms: Set<string>, step }
// step: 'platforms' | 'time' | 'await_custom_time'
const sessions = new Map();
// Текущая страница расписания по chatId.
const schedulePages = new Map();

/**
 * Проверяет, разрешён ли доступ пользователю.
 * Если allowedUserIds пуст — пускаем всех.
 */
function isAllowed(userId) {
  if (!config.allowedUserIds || config.allowedUserIds.length === 0) return true;
  return config.allowedUserIds.includes(String(userId));
}

/**
 * Inline-клавиатура главного меню.
 */
function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📅 Расписание', callback_data: 'menu:schedule' }],
      [{ text: '➕ Новая публикация', callback_data: 'menu:publish' }],
    ],
  };
}

/**
 * Строит inline-клавиатуру выбора площадок с галочками для выбранных.
 */
function buildPlatformsKeyboard(selected) {
  const rows = config.PLATFORMS.map((p) => [
    {
      text: `${selected.has(p.id) ? '✅ ' : ''}${p.label}`,
      callback_data: `toggle:${p.id}`,
    },
  ]);
  rows.push([{ text: 'Готово ➡️', callback_data: 'platforms_done' }]);
  return { inline_keyboard: rows };
}

/**
 * Inline-клавиатура выбора времени публикации.
 */
function buildTimeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'Сейчас', callback_data: 'time:now' }],
      [{ text: 'Через 1 час', callback_data: 'time:1h' }],
      [{ text: 'Через 3 часа', callback_data: 'time:3h' }],
      [{ text: 'Запланировать…', callback_data: 'time:custom' }],
    ],
  };
}

/**
 * Парсит строку формата "ГГГГ-ММ-ДД ЧЧ:ММ" как локальное время сервера.
 * @returns {number|null} unix ms или null при неверном формате
 */
function parseCustomTime(text) {
  const m = String(text)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  // Локальное время сервера (месяц 0-индексный).
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Проверяем, что компоненты не "переехали" (например, 31 февраля).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * Формат времени для подтверждения.
 */
function formatTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Возвращает человекочитаемые названия выбранных площадок.
 */
function platformLabels(ids) {
  return config.PLATFORMS.filter((p) => ids.includes(p.id)).map((p) => p.label);
}

function shortPlatformLabels(ids) {
  return ids.map((id) => PLATFORM_SHORT[id] || id).join(', ');
}

function truncateCaption(caption, maxLen = 30) {
  if (!caption) return '';
  const s = String(caption).trim();
  if (!s) return '';
  if (s.length <= maxLen) return ` «${s}»`;
  return ` «${s.slice(0, maxLen)}…»`;
}

function mediaTypeIcon(mediaType) {
  return mediaType === 'video' ? '🎬' : '📷';
}

function formatScheduleLine(job) {
  const platforms = shortPlatformLabels(job.platforms);
  const caption = truncateCaption(job.caption);
  return `#${job.id} · ${formatTime(job.publish_at)} · ${platforms} · ${mediaTypeIcon(job.media_type)}${caption}`;
}

/**
 * Формирует текст и клавиатуру экрана расписания.
 */
function buildScheduleMessage(chatId, page) {
  const total = countPendingJobsByChatId(chatId);
  const maxPage = Math.max(0, Math.ceil(total / SCHEDULE_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  const offset = safePage * SCHEDULE_PAGE_SIZE;
  const jobs = getPendingJobsByChatId(chatId, { limit: SCHEDULE_PAGE_SIZE, offset });

  let text;
  if (total === 0) {
    text = '📅 Расписание\n\nНет запланированных публикаций.';
  } else {
    const lines = jobs.map(formatScheduleLine);
    text = `📅 Расписание (${total})\n\n${lines.join('\n')}`;
    if (maxPage > 0) {
      text += `\n\nСтраница ${safePage + 1} из ${maxPage + 1}`;
    }
  }

  const keyboard = [];
  for (const job of jobs) {
    keyboard.push([{ text: `🗑 #${job.id}`, callback_data: `schedule:del:${job.id}` }]);
  }

  const navRow = [];
  if (safePage > 0) {
    navRow.push({ text: '◀️', callback_data: `schedule:page:${safePage - 1}` });
  }
  if (safePage < maxPage) {
    navRow.push({ text: '▶️', callback_data: `schedule:page:${safePage + 1}` });
  }
  if (navRow.length) keyboard.push(navRow);

  if (total === 0) {
    keyboard.push([{ text: '➕ Новая публикация', callback_data: 'menu:publish' }]);
  }
  keyboard.push([{ text: '◀️ В меню', callback_data: 'menu:home' }]);

  schedulePages.set(chatId, safePage);
  return { text, reply_markup: { inline_keyboard: keyboard }, page: safePage };
}

async function sendMainMenu(bot, chatId) {
  await bot.sendMessage(chatId, MAIN_MENU_TEXT, {
    reply_markup: buildMainMenuKeyboard(),
  });
}

async function showSchedule(bot, chatId, page, { messageId } = {}) {
  const { text, reply_markup } = buildScheduleMessage(chatId, page);
  const opts = { reply_markup };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (!msg.includes('message is not modified')) {
        await bot.sendMessage(chatId, text, opts);
      }
    }
  } else {
    await bot.sendMessage(chatId, text, opts);
  }
}

function deleteJobMedia(mediaPath) {
  if (!mediaPath) return;
  fs.unlink(mediaPath, (err) => {
    if (err) {
      console.error('[bot] Не удалось удалить медиафайл:', err.message);
    }
  });
}

/**
 * Определяет тип медиа по документу (файл, отправленный без сжатия).
 * @returns {'photo'|'video'|null}
 */
function mediaTypeFromDocument(doc) {
  if (!doc) return null;

  const mime = String(doc.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';

  const ext = path.extname(doc.file_name || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'photo';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';

  return null;
}

/**
 * Скачивает URL в файл через встроенный https (стабильнее на VPS, чем request в downloadFile).
 */
function downloadUrlToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const cleanup = (err) => {
      file.destroy();
      fs.unlink(filePath, () => reject(err));
    };

    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        cleanup(new Error(`Telegram file HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      res.on('error', cleanup);
      file.on('finish', () => file.close(() => resolve(filePath)));
      file.on('error', cleanup);
    });
    req.on('error', cleanup);
    req.setTimeout(120_000, () => {
      req.destroy(new Error('Telegram file download timeout'));
    });
  });
}

/**
 * Скачивает файл из Telegram с повторами при обрыве соединения.
 */
async function downloadMediaFile(bot, fileId, destDir, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const link = await bot.getFileLink(fileId);
      const fileName = link.slice(link.lastIndexOf('/') + 1);
      const filePath = path.join(destDir, `${Date.now()}_${fileName}`);
      return await downloadUrlToFile(link, filePath);
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      const retriable = /premature close|ECONNRESET|ETIMEDOUT|socket hang up|download timeout/i.test(
        msg,
      );
      if (!retriable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Извлекает тип и file_id из фото, видео или документа с изображением/видео.
 * @returns {{ mediaType: 'photo'|'video', fileId: string }|null}
 */
function resolveMediaFromMessage(msg) {
  if (msg.photo && msg.photo.length > 0) {
    return { mediaType: 'photo', fileId: msg.photo[msg.photo.length - 1].file_id };
  }
  if (msg.video) {
    return { mediaType: 'video', fileId: msg.video.file_id };
  }
  if (msg.document) {
    const mediaType = mediaTypeFromDocument(msg.document);
    if (mediaType) {
      return { mediaType, fileId: msg.document.file_id };
    }
  }
  return null;
}

/**
 * Финализирует задание: создаёт job в БД, чистит состояние, шлёт подтверждение.
 */
async function finalizeJob(bot, chatId, session, publishAt) {
  const platforms = Array.from(session.platforms);

  const jobId = createJob({
    userId: chatId,
    chatId,
    mediaPath: session.mediaPath,
    mediaType: session.mediaType,
    platforms,
    caption: session.caption,
    publishAt,
  });

  sessions.delete(chatId);

  const labels = platformLabels(platforms).join(', ');
  await bot.sendMessage(
    chatId,
    `✅ Готово! Запланировано (#${jobId}).\n\n` +
      `Площадки: ${labels}\n` +
      `Время публикации: ${formatTime(publishAt)}`,
  );
}

/**
 * Планирует перезапуск polling после сетевой ошибки.
 */
function schedulePollingRestart(bot, restartState, delayMs) {
  if (restartState.timer) return;
  restartState.timer = setTimeout(() => {
    restartState.timer = null;
    const action = bot.isPolling()
      ? bot.stopPolling({ cancel: true, reason: 'Network error recovery' }).then(() => bot.startPolling())
      : bot.startPolling();
    action.catch((e) => {
      console.error('[bot] Не удалось перезапустить polling:', e && e.message ? e.message : e);
    });
  }, delayMs);
}

/**
 * Создаёт и настраивает экземпляр Telegram-бота.
 * @returns {TelegramBot}
 */
function createBot() {
  const restartState = { timer: null };
  const bot = new TelegramBot(config.botToken, {
    polling: {
      autoStart: false,
      params: { timeout: 10 },
    },
  });

  bot.on('polling_error', (err) => {
    const msg = err && err.message ? err.message : String(err);

    if (msg.includes('409 Conflict')) {
      console.error(
        '[bot] Конфликт polling: другой процесс уже опрашивает этого бота. ' +
          'Остановите лишние экземпляры `npm start`.',
      );
      return;
    }

    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(msg)) {
      console.warn(`[bot] Сетевая ошибка polling, перезапуск через 5 с: ${msg}`);
      schedulePollingRestart(bot, restartState, 5000);
      return;
    }

    console.error('[bot] polling_error:', msg);
  });

  bot
    .deleteWebHook()
    .catch(() => {})
    .finally(() => {
      bot.startPolling().catch((e) => {
        console.error('[bot] Не удалось запустить polling:', e && e.message ? e.message : e);
      });
    });

  // /start и /help
  bot.onText(/^\/(start|help)\b/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      if (!isAllowed(msg.from && msg.from.id)) {
        await bot.sendMessage(chatId, 'Извините, у вас нет доступа к этому боту.');
        return;
      }
      await sendMainMenu(bot, chatId);
    } catch (err) {
      console.error('Ошибка в /start|/help:', err);
    }
  });

  // Приём фото и видео.
  bot.on('message', async (msg) => {
    try {
      // Команды обрабатываются отдельно через onText.
      if (msg.text && msg.text.startsWith('/')) return;

      const chatId = msg.chat.id;
      if (!isAllowed(msg.from && msg.from.id)) {
        // Реагируем только если есть полезная нагрузка, чтобы не спамить.
        if (msg.photo || msg.video || msg.document || msg.text) {
          await bot.sendMessage(chatId, 'Извините, у вас нет доступа к этому боту.');
        }
        return;
      }

      // Ожидание ручного ввода времени.
      if (msg.text) {
        const session = sessions.get(chatId);
        if (session && session.step === 'await_custom_time') {
          const publishAt = parseCustomTime(msg.text);
          if (publishAt === null) {
            await bot.sendMessage(
              chatId,
              'Не понял формат. Пришлите дату и время как «ГГГГ-ММ-ДД ЧЧ:ММ», например:\n\n<code>2026-06-18 09:30</code>',
              { parse_mode: 'HTML' },
            );
            return;
          }
          await finalizeJob(bot, chatId, session, publishAt);
          return;
        }
      }

      const resolved = resolveMediaFromMessage(msg);

      if (!resolved) {
        if (msg.document) {
          await bot.sendMessage(
            chatId,
            'Этот документ не похож на фото или видео. Пришлите изображение или видеофайл. /help — подсказка.',
          );
          return;
        }
        if (msg.text) {
          await bot.sendMessage(
            chatId,
            'Пришлите, пожалуйста, фото или видео (можно файлом-документом). /help — подсказка.',
          );
        }
        return;
      }

      const { mediaType, fileId } = resolved;

      const mediaPath = await downloadMediaFile(bot, fileId, config.mediaDir);

      sessions.set(chatId, {
        mediaPath,
        mediaType,
        caption: msg.caption || null,
        platforms: new Set(),
        step: 'platforms',
      });

      await bot.sendMessage(chatId, 'Медиа получено. Выберите площадки:', {
        reply_markup: buildPlatformsKeyboard(new Set()),
      });
    } catch (err) {
      console.error('Ошибка в обработчике message:', err);
      const chatId = msg && msg.chat && msg.chat.id;
      if (chatId) {
        const hint =
          err && err.message && /premature close|ECONNRESET|ETIMEDOUT/i.test(err.message)
            ? 'Не удалось скачать файл с Telegram (обрыв соединения). Попробуйте ещё раз или отправьте файл поменьше.'
            : 'Не удалось обработать сообщение. Попробуйте ещё раз.';
        await bot.sendMessage(chatId, hint).catch(() => {});
      }
    }
  });

  // Обработка нажатий inline-кнопок.
  bot.on('callback_query', async (query) => {
    try {
      const msg = query.message;
      const chatId = msg.chat.id;
      const data = query.data || '';

      if (!isAllowed(query.from && query.from.id)) {
        await bot.answerCallbackQuery(query.id, { text: 'Нет доступа' });
        return;
      }

      // Главное меню.
      if (data === 'menu:home') {
        await bot.answerCallbackQuery(query.id);
        try {
          await bot.editMessageText(MAIN_MENU_TEXT, {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: buildMainMenuKeyboard(),
          });
        } catch {
          await sendMainMenu(bot, chatId);
        }
        return;
      }

      if (data === 'menu:publish') {
        sessions.delete(chatId);
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          'Пришлите фото или видео (можно с подписью или файлом-документом).',
        );
        return;
      }

      if (data === 'menu:schedule') {
        await bot.answerCallbackQuery(query.id);
        await showSchedule(bot, chatId, 0);
        return;
      }

      if (data.startsWith('schedule:page:')) {
        const page = Number(data.slice('schedule:page:'.length)) || 0;
        await bot.answerCallbackQuery(query.id);
        await showSchedule(bot, chatId, page, { messageId: msg.message_id });
        return;
      }

      if (data.startsWith('schedule:del:')) {
        const jobId = Number(data.slice('schedule:del:'.length));
        const result = deletePendingJob(jobId, chatId);
        if (!result.deleted) {
          await bot.answerCallbackQuery(query.id, { text: 'Задание не найдено' });
          return;
        }
        deleteJobMedia(result.mediaPath);
        await bot.answerCallbackQuery(query.id, { text: `Задание #${jobId} удалено` });

        const total = countPendingJobsByChatId(chatId);
        const maxPage = Math.max(0, Math.ceil(total / SCHEDULE_PAGE_SIZE) - 1);
        const currentPage = schedulePages.get(chatId) || 0;
        const targetPage = Math.min(currentPage, maxPage);
        await showSchedule(bot, chatId, targetPage, { messageId: msg.message_id });
        return;
      }

      const session = sessions.get(chatId);
      if (!session) {
        await bot.answerCallbackQuery(query.id, {
          text: 'Сессия не найдена. Пришлите медиа заново или откройте /start.',
        });
        return;
      }

      // Переключение площадки.
      if (data.startsWith('toggle:')) {
        const id = data.slice('toggle:'.length);
        if (session.platforms.has(id)) session.platforms.delete(id);
        else session.platforms.add(id);

        await bot.editMessageReplyMarkup(buildPlatformsKeyboard(session.platforms), {
          chat_id: chatId,
          message_id: msg.message_id,
        });
        await bot.answerCallbackQuery(query.id);
        return;
      }

      // Завершение выбора площадок.
      if (data === 'platforms_done') {
        if (session.platforms.size === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'Выберите хотя бы одну площадку' });
          return;
        }
        session.step = 'time';
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, 'Когда опубликовать?', {
          reply_markup: buildTimeKeyboard(),
        });
        return;
      }

      // Выбор времени.
      if (data.startsWith('time:')) {
        const kind = data.slice('time:'.length);
        await bot.answerCallbackQuery(query.id);

        if (kind === 'custom') {
          session.step = 'await_custom_time';
          await bot.sendMessage(
            chatId,
            'Пришлите дату и время в формате «ГГГГ-ММ-ДД ЧЧ:ММ» (локальное время сервера), например:\n\n<code>2026-06-18 09:30</code>',
            { parse_mode: 'HTML' },
          );
          return;
        }

        let publishAt;
        if (kind === 'now') publishAt = Date.now();
        else if (kind === '1h') publishAt = Date.now() + 3600_000;
        else if (kind === '3h') publishAt = Date.now() + 3 * 3600_000;
        else return;

        await finalizeJob(bot, chatId, session, publishAt);
        return;
      }

      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('Ошибка в callback_query:', err);
    }
  });

  return bot;
}

module.exports = { createBot };
