'use strict';

const fs = require('fs');
const config = require('./config');
const { createBot } = require('./bot/flow');
const { startScheduler } = require('./scheduler');
const publishers = require('./publishers');
const { acquireInstanceLock } = require('./singleInstance');

function checkConfig() {
  const warnings = [];
  if (!config.botToken) warnings.push('BOT_TOKEN не задан — бот не запустится.');
  if (!config.tg.apiId || !config.tg.apiHash) {
    warnings.push('TG_API_ID/TG_API_HASH не заданы — Telegram-сторис работать не будут.');
  }
  if (!config.tg.stringSession) {
    warnings.push('TG_STRING_SESSION не задан — выполни `npm run login` и вставь строку в .env.');
  }
  if (!config.vk.groupId) {
    warnings.push('VK_GROUP_ID не задан — публикация в ВК-сообщество недоступна.');
  } else {
    const hasCommunityToken = Boolean(config.vk.communityToken);
    const hasOAuthTokens =
      (config.vk.accessToken && config.vk.refreshToken && config.vk.deviceId && config.vk.clientId) ||
      fs.existsSync(config.vk.tokensPath);
    if (!hasCommunityToken && !hasOAuthTokens) {
      warnings.push(
        'VK не авторизован — задай VK_TOKEN (ключ сообщества) или выполни `npm run vk-login`.',
      );
    }
  }
  if (warnings.length) {
    console.warn('[config] Предупреждения:');
    for (const w of warnings) console.warn('  - ' + w);
  }
}

function main() {
  acquireInstanceLock();
  checkConfig();

  if (!config.botToken) {
    console.error('Нет BOT_TOKEN. Заполни .env (см. env.example) и перезапусти.');
    process.exit(1);
  }

  const bot = createBot();
  startScheduler({ bot, publishers });

  console.log('Сервис автопостинга запущен. Планировщик активен, бот слушает сообщения.');

  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
}

main();
