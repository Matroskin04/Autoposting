'use strict';

require('dotenv').config({ quiet: true });
const path = require('path');

function parseIds(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => String(s));
}

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const mediaDir = path.join(dataDir, 'media');

const config = {
  rootDir,
  dataDir,
  mediaDir,
  dbPath: path.join(dataDir, 'db.sqlite'),

  botToken: process.env.BOT_TOKEN || '',

  tg: {
    apiId: Number(process.env.TG_API_ID || 0),
    apiHash: process.env.TG_API_HASH || '',
    stringSession: process.env.TG_STRING_SESSION || '',
    channel: process.env.TG_CHANNEL || '',
  },

  vk: {
    clientId: process.env.VK_CLIENT_ID || '',
    // Постоянный ключ доступа сообщества (не привязан к IP, не протухает).
    // Если задан — используется в приоритете, без OAuth и refresh.
    communityToken: process.env.VK_TOKEN || '',
    // Пользовательский токен VK ID OAuth (привязан к IP, обновляется через refresh).
    accessToken: process.env.VK_ACCESS_TOKEN || '',
    refreshToken: process.env.VK_REFRESH_TOKEN || '',
    deviceId: process.env.VK_DEVICE_ID || '',
    groupId: Number(process.env.VK_GROUP_ID || 0),
    tokensPath: path.join(dataDir, 'vk-tokens.json'),
    // Таймауты vk-io в мс. Заливку медиа держим большой (по умолчанию 5 мин).
    uploadTimeoutMs: Number(process.env.VK_UPLOAD_TIMEOUT_MS || 300_000),
    apiTimeoutMs: Number(process.env.VK_API_TIMEOUT_MS || 90_000),
  },

  allowedUserIds: parseIds(process.env.ALLOWED_USER_IDS),
  timezone: process.env.TZ || 'UTC',
};

/**
 * Список доступных площадок. id используется как ключ в publishers и в БД.
 */
const PLATFORMS = [
  { id: 'vk_group', label: 'ВК — сообщество' },
  { id: 'tg_personal', label: 'Telegram — личная страница' },
  { id: 'tg_channel', label: 'Telegram — канал' },
];

config.PLATFORMS = PLATFORMS;

module.exports = config;
