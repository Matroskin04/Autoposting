'use strict';

const fs = require('fs');
const path = require('path');
const { CustomFile } = require('telegram/client/uploads');
const { generateRandomBigInt } = require('telegram/Helpers');
const { getTelegramClient, Api } = require('../tgClient');
const config = require('../config');

/**
 * Публикует сторис от имени Telegram-канала через MTProto.
 * @param {{ mediaPath: string, mediaType: 'photo'|'video', caption?: string }} opts
 * @returns {Promise<{ ok: boolean, info?: any, error?: string }>}
 */
async function publishTgChannel({ mediaPath, mediaType, caption }) {
  try {
    if (!config.tg.channel) {
      return { ok: false, error: 'TG_CHANNEL не задан' };
    }

    const client = await getTelegramClient();
    const peer = await client.getInputEntity(config.tg.channel);

    // Проверяем возможность отправки сторис от имени канала.
    try {
      await client.invoke(new Api.stories.CanSendStory({ peer }));
    } catch (e) {
      return { ok: false, error: `Нельзя отправить сторис: ${String(e)}` };
    }

    const file = await client.uploadFile({
      file: new CustomFile(
        path.basename(mediaPath),
        fs.statSync(mediaPath).size,
        mediaPath
      ),
      workers: 1,
    });

    let media;
    if (mediaType === 'video') {
      media = new Api.InputMediaUploadedDocument({
        file,
        mimeType: 'video/mp4',
        attributes: [
          new Api.DocumentAttributeVideo({
            duration: 0,
            w: 720,
            h: 1280,
            supportsStreaming: true,
          }),
        ],
      });
    } else {
      media = new Api.InputMediaUploadedPhoto({ file });
    }

    const result = await client.invoke(
      new Api.stories.SendStory({
        peer,
        media,
        privacyRules: [new Api.InputPrivacyValueAllowAll({})],
        randomId: generateRandomBigInt(),
        period: 86400,
        caption: caption || undefined,
      })
    );

    return { ok: true, info: result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

module.exports = { publishTgChannel };
