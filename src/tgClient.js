'use strict';

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');

let clientPromise = null;

/**
 * Возвращает синглтон подключённого GramJS клиента.
 * При первом вызове создаёт клиент, подключается и кэширует его.
 * @returns {Promise<import('telegram').TelegramClient>}
 */
async function getTelegramClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const client = new TelegramClient(
      new StringSession(config.tg.stringSession),
      config.tg.apiId,
      config.tg.apiHash,
      { connectionRetries: 5 }
    );
    await client.connect();
    return client;
  })();

  try {
    return await clientPromise;
  } catch (e) {
    // Сбрасываем кэш, чтобы следующий вызов мог попробовать заново.
    clientPromise = null;
    throw e;
  }
}

module.exports = { getTelegramClient, Api };
