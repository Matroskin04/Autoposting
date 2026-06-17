'use strict';

const { VK } = require('vk-io');
const config = require('../config');
const { getAccessToken } = require('../vkAuth');

/**
 * Публикует сторис в сообщество ВКонтакте.
 * @param {{ mediaPath: string, mediaType: 'photo'|'video', caption?: string }} opts
 * @returns {Promise<{ ok: boolean, info?: any, error?: string }>}
 */
async function publishVkGroup({ mediaPath, mediaType, caption }) {
  try {
    if (!config.vk.groupId) {
      return { ok: false, error: 'VK не настроен' };
    }

    const token = await getAccessToken();
    // По умолчанию vk-io обрывает загрузку через 20с (uploadTimeout) — для видео по
    // медленной сети это даёт AbortError. Лимиты настраиваются через .env.
    const vk = new VK({
      token,
      apiTimeout: config.vk.apiTimeoutMs,
      uploadTimeout: config.vk.uploadTimeoutMs,
    });

    let result;
    if (mediaType === 'video') {
      result = await vk.upload.storiesVideo({
        source: { value: mediaPath },
        group_id: config.vk.groupId,
        add_to_news: 1,
      });
    } else {
      result = await vk.upload.storiesPhoto({
        source: { value: mediaPath },
        group_id: config.vk.groupId,
        add_to_news: 1,
      });
    }

    return { ok: true, info: result };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return {
        ok: false,
        error: 'Таймаут загрузки в ВК (файл слишком большой или медленная сеть). Попробуй ещё раз или уменьши видео.',
      };
    }
    return { ok: false, error: String(e) };
  }
}

module.exports = { publishVkGroup };
