# DoQA JavaScript adapter commons

Модуль `doqa-js-commons`, npm-пакет разработки `doqa-js-commons-dev`.
Зависит от `doqa-js-client-dev`; зависимостей и глобальных объектов Jest не требует.

- `resolveConfig`, `Options`, `Config`: настройки и приоритет options → DOQA_* → properties.
- `RecordResult`, `Step`, `Metadata`: общий контракт результатов, шагов и вложений.
- `Runtime`: async-контекст отдельного теста/шага и сохранение вложений.
- `atomic`, `hash`: запись worker-результатов и вычисление идентификаторов.
- `writeAllure`: файловые результаты с переданными сведениями о фреймворке.
- `/session`: `prepareSession` создаёт сессию и загружает план.
- `/coordinator`: `Coordinator.start()` / `complete()` управляют прогоном,
  чтением worker-файлов, отправкой чанков, вложениями и recovery/receipts.

HTTP-компоненты вынесены в отдельные exports: импорт основного entry point
не загружает HTTP-клиент в тестовый VM-контекст jsdom.

```js
const { Coordinator } = require('doqa-js-commons-dev/coordinator');
const coordinator = new Coordinator(
  { reporting: 'files', sessionDir: '.doqa/example', resultsDir: 'results' },
  { name: 'example-runner', language: 'javascript', displayName: 'Example runner' },
);
```

Адаптер создаёт одну сессию и coordinator на запуск, передаёт worker-процессам
`sessionDir`, сохраняет `RecordResult` в `*.record.json` через `atomic` и вызывает
`complete()` после завершения workers. На стороне workers `Runtime.context.run`
связывает `result` с пользовательским кодом. Маппинг событий фреймворка,
статусов ошибок, правил выбора и порядка тестов остаётся в самом адаптере.

Node.js 22/24, CJS/ESM и типы TypeScript. Сборка и тесты из корня `doqa-js`:
`npm run build`, затем `npm run test --workspace doqa-js-commons`.
