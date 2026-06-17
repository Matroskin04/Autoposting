'use strict';

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const qrcode = require('qrcode-terminal');
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

  console.log(
    'Вход по QR — код в чат «Telegram» не нужен.\n' +
      'На телефоне: Telegram → Настройки → Устройства → Подключить устройство → сканируй QR ниже.\n'
  );

  await client.connect();

  await client.signInUserWithQrCode(
    { apiId: config.tg.apiId, apiHash: config.tg.apiHash },
    {
      qrCode: async ({ token, expires }) => {
        const url = `tg://login?token=${token.toString('base64url')}`;
        const secLeft = Math.max(0, Math.round((expires - Date.now()) / 1000));
        console.log(`\nНовый QR (действует ~${secLeft} сек):\n`);
        qrcode.generate(url, { small: true });
      },
      password: async () => await input.text('Пароль 2FA (если есть): '),
      onError: (err) => console.error(err),
    }
  );

  console.log('\nТвой TG_STRING_SESSION:');
  console.log(client.session.save());
  console.log('\nСкопируй строку выше в .env как TG_STRING_SESSION=<строка>');

  await client.disconnect();
  process.exit(0);
})();
