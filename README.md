# Autoposting — отложенный автопостинг сторис

Telegram-бот, который принимает фото/видео и публикует их в виде **сторис**:

- ВК — сообщество
- Telegram — личная страница
- Telegram — канал

Публикация — сразу или по расписанию. Всё работает бесплатно на одном Node.js-процессе.

## Как это устроено

```
node-telegram-bot-api  → интерфейс бота (приём медиа, меню, выбор времени)
telegram (GramJS)      → постинг ТГ-сторис (личная страница + канал) через MTProto
vk-io                  → постинг ВК-сторис сообщества
better-sqlite3         → хранение заданий
node-cron              → запуск отложенных публикаций
```

Бот сохраняет медиа на диск (`data/media`) и создаёт задание в SQLite (`data/db.sqlite`).
Планировщик раз в минуту проверяет, какие задания пора публиковать, и вызывает паблишеры.

## Требования

- Node.js 18+ (рекомендуется 20/22)
- Аккаунт Telegram (для входа через MTProto)
- Для ВК: токен пользователя-админа сообщества со scope `stories`

## Установка

```bash
npm install
cp env.example .env   # на Windows: copy env.example .env
```

Заполни `.env` (см. раздел ниже про получение токенов), затем один раз авторизуйся в Telegram:

```bash
npm run login
```

Скрипт спросит номер телефона, код из Telegram (и пароль 2FA, если включён) и выведет строку `TG_STRING_SESSION` — вставь её в `.env`.

Запуск:

```bash
npm start
```

## Где взять токены и ID

### BOT_TOKEN
Напиши [@BotFather](https://t.me/BotFather) → `/newbot` → получишь токен.

### TG_API_ID / TG_API_HASH
Зайди на https://my.telegram.org → API development tools → создай приложение → скопируй `api_id` и `api_hash`.

### TG_STRING_SESSION
`npm run login:qr` - лучше использовать это

Получается командой `npm run login` (см. выше). Это сессия твоего личного аккаунта — храни её в секрете.

### TG_CHANNEL
Username канала (`@mychannel`) или его числовой id (`-100...`). Твой аккаунт должен быть админом канала.

### VK-токены: VK_TOKEN или VK_ACCESS_TOKEN
Приоритет: если задан `VK_TOKEN` (ключ сообщества) — используется он, OAuth-токены игнорируются.
Если `VK_TOKEN` пуст — берётся связка `VK_ACCESS_TOKEN` + `VK_REFRESH_TOKEN` (с авто-обновлением).

#### Вариант 1 (предпочтительный, не привязывается по ip, refresh не нужен) — `VK_TOKEN`
Как получить (по шагам)
Зайди в своё сообщество → Управление.
Слева: Настройки → Работа с API.
Вкладка Ключи доступа → Создать ключ.
Отметь права: Истории (stories), Управление сообществом, при необходимости Фотографии, Документы, Стена.
Подтверди — получишь длинный токен. Это и есть access_token сообщества. Вставь его в `.env` как `VK_TOKEN`.
Официальная инструкция (ссылка):

https://dev.vk.com/ru/api/access-token/community-token/in-community-settings

#### Вариант 2 (привязывается по ip, нужен refresh) — `VK_ACCESS_TOKEN` + `VK_REFRESH_TOKEN`
1. Создай приложение в [кабинете VK ID](https://id.vk.com/about/business/go).
2. В настройках включи права `stories`, `groups`, `offline` и добавь redirect URL: `https://oauth.vk.com/blank.html`.
3. Скопируй ID приложения в `.env` как `VK_CLIENT_ID`.
4. Получи токены одной командой:

```bash
npm run vk-login
```

Скрипт сохранит `access_token`, `refresh_token` и `device_id` в `data/vk-tokens.json`.
Бот автоматически обновляет `access_token` (~1 час) через `refresh_token` (до 180 дней).
Повторный `npm run vk-login` нужен только если refresh-цепочка оборвалась.

Старый способ через `oauth.vk.com/authorize?response_type=token` для новых приложений не работает.

### VK_GROUP_ID
Числовой id сообщества (без минуса). Ты должен быть его администратором.

## Ограничения площадок (важно)

- **ВК-сообщество**: публикация сторис от сообщества через API доступна только верифицированным сообществам или с «огоньком». Обычное сообщество может получить ошибку.
- **Telegram-канал**: сторис у канала открываются только при достаточном boost-уровне. Без него `SendStory` для канала вернёт ошибку.
- **Бесплатный Telegram-аккаунт**: период сторис фиксирован (24 часа) и есть дневной лимит на число историй.
- **Размер видео**: бот скачивает файлы через Bot API с лимитом ~20 МБ. Для коротких вертикальных клипов этого хватает.

## Деплой 24/7 (бесплатно)

Рекомендуется **Oracle Cloud Free Tier** (always-free ARM VM):

```bash
# на сервере
git clone <repo> && cd autoposting
npm install
cp env.example .env && nano .env   # заполнить
npm run login                       # один раз, получить сессию
# процесс-менеджер
npm i -g pm2
pm2 start src/index.js --name autoposting
pm2 save && pm2 startup
```

Данные (`data/`) и `.env` должны лежать на постоянном диске и не попадать в git (см. `.gitignore`).

## Структура проекта

```
src/
  index.js            точка входа (бот + планировщик)
  config.js           конфигурация из .env
  db.js               SQLite: задания
  scheduler.js        node-cron: запуск отложенных публикаций
  tgClient.js         singleton GramJS-клиента (MTProto)
  vkAuth.js           VK ID: хранение и автообновление токенов
  bot/
    flow.js           сценарий бота (приём медиа, выбор площадок и времени)
  publishers/
    index.js          карта площадок -> функция публикации
    vk.js             ВК-сообщество (vk-io)
    tgPersonal.js     ТГ личная страница (GramJS)
    tgChannel.js      ТГ канал (GramJS)
scripts/
  login.js            одноразовый вход в Telegram (StringSession)
data/                 медиа и БД (создаётся автоматически, в .gitignore)
```
