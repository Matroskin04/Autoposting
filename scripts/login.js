'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const config = require('../src/config');

(async () => {
  if (!config.tg.apiId || !config.tg.apiHash) {
    console.error('Сначала задай TG_API_ID и TG_API_HASH в .env');
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(''),
    config.tg.apiId,
    config.tg.apiHash,
    { connectionRetries: 5 }
  );

  const forceSMS = process.env.TG_LOGIN_FORCE_SMS === '1';

  await client.start({
    phoneNumber: async () => {
      const raw = await input.text('Телефон (+79123456789): ');
      const phone = raw.trim().replace(/\s/g, '');
      if (/^8\d{10}$/.test(phone)) return `+7${phone.slice(1)}`;
      if (/^\d{10,15}$/.test(phone)) return `+${phone}`;
      return phone;
    },
    forceSMS,
    password: async () => await input.text('Пароль 2FA (если есть): '),
    phoneCode: async (isCodeViaApp) => {
      if (isCodeViaApp) {
        console.log(
          '\nКод отправлен в приложение Telegram (чат «Telegram», не SMS).\n' +
            'Открой Telegram на телефоне/десктопе — аккаунт должен быть уже залогинен.\n' +
            'Где искать: чат «Telegram», push-уведомление, Настройки → Устройства.\n' +
            'Номер в скрипте должен совпадать с аккаунтом (+7..., не 8...).\n' +
            'SMS для многих номеров недоступен (ошибка SEND_CODE_UNAVAILABLE) — не используй TG_LOGIN_FORCE_SMS.\n'
        );
      } else {
        console.log('\nКод отправлен SMS на ваш номер.\n');
      }
      return await input.text('Код: ');
    },
    onError: console.error,
  });

  console.log('\nТвой TG_STRING_SESSION:');
  console.log(client.session.save());
  console.log('\nСкопируй строку выше в .env как TG_STRING_SESSION=<строка>');

  process.exit(0);
})();
