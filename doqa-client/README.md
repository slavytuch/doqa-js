# DoQA JavaScript API client

Модуль `doqa-client`, npm-пакет разработки `doqa-js-client-dev`.
Не зависит от Jest и общего ядра адаптеров.

`Client` отправляет запросы в `/api/autotests/`, добавляет token/space_id,
поддерживает JSON и multipart (`FormData`), TLS/proxy, таймауты и circuit breaker.
Безопасные запросы могут повторяться при временных ошибках; небезопасные POST
не повторяются после неопределённого результата доставки. Диагностика не раскрывает
токен и тело ответа. После использования нужно вызвать `await client.close()`.

```js
const { Client } = require('doqa-js-client-dev');
const client = new Client({
  url: process.env.DOQA_URL,
  token: process.env.DOQA_TOKEN,
  spaceId: process.env.DOQA_SPACE_ID,
  requestTimeoutMs: 30000,
  retries: 3,
  retryBackoffMs: 500,
});
try {
  const plan = await client.request('test-runs/123/autotests', {}, 'GET');
} finally {
  await client.close();
}
```

Пример вызывается внутри async-функции. Node.js 22/24, CJS/ESM и типы TypeScript.
Сборка и тесты выполняются из корня `doqa-js`: `npm run build`, затем
`npm run test --workspace doqa-client`. Релизная версия общая для всех модулей.
