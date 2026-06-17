'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const VK_OAUTH_URL = 'https://id.vk.com/oauth2/auth';
const REDIRECT_URI = 'https://oauth.vk.com/blank.html';
const SCOPE = 'stories,groups,offline';
const OAUTH_STATE = 'autoposting_vk_oauth_state_32chars_ok';
const REFRESH_SKEW_MS = 60_000;

let refreshPromise = null;

function loadStore() {
  const filePath = config.vk.tokensPath;
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function saveStore(store) {
  const filePath = config.vk.tokensPath;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function buildStoreFromEnv() {
  if (!config.vk.accessToken) return null;

  return {
    clientId: config.vk.clientId || '',
    accessToken: config.vk.accessToken,
    refreshToken: config.vk.refreshToken || '',
    deviceId: config.vk.deviceId || '',
    expiresAt: 0,
  };
}

function getStore() {
  const fromFile = loadStore();
  if (fromFile?.accessToken) return fromFile;
  return buildStoreFromEnv();
}

function canRefresh(store) {
  return Boolean(store?.refreshToken && store?.deviceId && store?.clientId);
}

function isExpired(store) {
  if (!store?.expiresAt) return false;
  return Date.now() >= store.expiresAt - REFRESH_SKEW_MS;
}

async function vkOAuthRequest(body) {
  const res = await fetch(VK_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  }

  return data;
}

function storeFromTokenResponse({ clientId, deviceId, tokenData }) {
  return {
    clientId: String(clientId),
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || '',
    deviceId: deviceId || '',
    expiresAt: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
  };
}

async function exchangeCodeForTokens({ clientId, code, deviceId, verifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: String(clientId),
    device_id: deviceId,
    code_verifier: verifier,
    state: OAUTH_STATE,
  });

  return vkOAuthRequest(body);
}

async function refreshAccessToken(store) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: store.refreshToken,
    client_id: String(store.clientId),
    device_id: store.deviceId,
    state: OAUTH_STATE,
  });

  const tokenData = await vkOAuthRequest(body);
  const nextStore = storeFromTokenResponse({
    clientId: store.clientId,
    deviceId: store.deviceId,
    tokenData,
  });

  saveStore(nextStore);
  return nextStore.accessToken;
}

function saveTokensFromLogin({ clientId, deviceId, tokenData }) {
  const store = storeFromTokenResponse({ clientId, deviceId, tokenData });
  saveStore(store);
  return store;
}

/**
 * Возвращает актуальный access_token.
 * Приоритет — постоянный ключ сообщества (VK_TOKEN): он не привязан к IP и не протухает.
 * Если его нет — используется пользовательский токен VK ID OAuth с авто-обновлением через refresh_token.
 */
async function getAccessToken() {
  if (config.vk.communityToken) {
    return config.vk.communityToken;
  }

  const store = getStore();
  if (!store?.accessToken) {
    throw new Error('VK не настроен');
  }

  if (!isExpired(store)) {
    return store.accessToken;
  }

  if (!canRefresh(store)) {
    return store.accessToken;
  }

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(store).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function buildAuthorizeUrl(clientId, challenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: String(clientId),
    scope: SCOPE,
    redirect_uri: REDIRECT_URI,
    state: OAUTH_STATE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `https://id.vk.com/authorize?${params}`;
}

module.exports = {
  REDIRECT_URI,
  SCOPE,
  OAUTH_STATE,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  saveTokensFromLogin,
  getAccessToken,
  getStore,
  canRefresh,
};
