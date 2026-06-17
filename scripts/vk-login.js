'use strict';

const crypto = require('crypto');
const { exec } = require('child_process');
const input = require('input');
const {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  saveTokensFromLogin,
} = require('../src/vkAuth');

function generatePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) console.log('Не удалось открыть браузер автоматически — открой ссылку вручную.');
  });
}

function parseRedirectUrl(raw) {
  const trimmed = raw.trim();
  const withProtocol = trimmed.startsWith('http') ? trimmed : `https://dummy.local/?${trimmed}`;
  const url = new URL(withProtocol);

  const code = url.searchParams.get('code');
  const deviceId = url.searchParams.get('device_id');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    throw new Error(`${error}: ${errorDescription || 'ошибка авторизации'}`);
  }
  if (!code || !deviceId) {
    throw new Error('В ссылке нет code или device_id. Скопируй полный URL из адресной строки после редиректа.');
  }

  return { code, deviceId };
}

(async () => {
  try {
    let clientId = process.env.VK_CLIENT_ID || '';
    if (!clientId) {
      clientId = await input.text('ID приложения VK (client_id): ');
    }
    clientId = clientId.trim();
    if (!clientId) {
      console.error('Нужен ID приложения. Задай VK_CLIENT_ID в .env или введи вручную.');
      process.exit(1);
    }

    const { verifier, challenge } = generatePkce();
    const authorizeUrl = buildAuthorizeUrl(clientId, challenge);

    console.log('\n1. Сейчас откроется браузер (или открой ссылку вручную).');
    console.log('2. Войди в VK и нажми «Разрешить».');
    console.log('3. Скопируй полный URL из адресной строки после редиректа.\n');
    console.log(authorizeUrl, '\n');

    openBrowser(authorizeUrl);

    const redirectRaw = await input.text('Вставь URL после редиректа: ');
    const { code, deviceId } = parseRedirectUrl(redirectRaw);

    console.log('\nОбмениваю code на токен...');
    const tokenData = await exchangeCodeForTokens({
      clientId,
      code,
      deviceId,
      verifier,
    });

    const store = saveTokensFromLogin({ clientId, deviceId, tokenData });

    console.log('\nТокены сохранены в data/vk-tokens.json');
    console.log('Бот будет автоматически обновлять access_token через refresh_token.\n');
    console.log('Для .env (опционально, как резервная копия):');
    console.log(`VK_CLIENT_ID=${store.clientId}`);
    console.log(`VK_ACCESS_TOKEN=${store.accessToken}`);
    if (store.refreshToken) console.log(`VK_REFRESH_TOKEN=${store.refreshToken}`);
    console.log(`VK_DEVICE_ID=${store.deviceId}`);
    console.log('\nПодсказка: если есть постоянный ключ сообщества — задай его в VK_TOKEN,');
    console.log('тогда OAuth-токены выше не нужны (VK_TOKEN не привязан к IP).');
  } catch (e) {
    console.error('\nОшибка:', e.message || e);
    process.exit(1);
  }

  process.exit(0);
})();
