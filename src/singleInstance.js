'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Проверяет, жив ли процесс с указанным PID (без отправки сигнала).
 */
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/**
 * Не даёт запустить второй экземпляр сервиса с тем же BOT_TOKEN.
 * Использует lock-файл в data/.instance.lock.
 */
function acquireInstanceLock() {
  const lockPath = path.join(config.dataDir, '.instance.lock');
  fs.mkdirSync(config.dataDir, { recursive: true });

  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (pid && pid !== process.pid && isProcessRunning(pid)) {
      console.error(
        `Сервис уже запущен (PID ${pid}). Остановите его и запустите снова.`,
      );
      process.exit(1);
    }
  }

  fs.writeFileSync(lockPath, String(process.pid));

  const release = () => {
    try {
      if (
        fs.existsSync(lockPath) &&
        fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)
      ) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Игнорируем ошибки при завершении процесса.
    }
  };

  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      release();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

module.exports = { acquireInstanceLock };
