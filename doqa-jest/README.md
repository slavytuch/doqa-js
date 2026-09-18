# DoQA Jest adapter

Адаптер Jest 29.7/30.x для Node.js 22/24: каталог и результаты DoQA, выборочные
запуски, шаги, фикстуры, параметры и вложения. JavaScript/TypeScript, CJS/ESM,
`jest-circus`, среды node/jsdom. Существующие `test` и `it` менять не нужно.

## Установка и подключение

Имя npm-пакета на время разработки — `doqa-js-dev`; модуль `doqa-jest` в репозитории `doqa-js`.
Опубликованную версию можно установить из npm:

```sh
npm install --save-dev doqa-js-dev
```

Для проверки локальной сборки из корня `doqa-js`:

```sh
npm ci
npm test
npm run pack
```

В тестовом проекте установите единый архив:

```sh
npm install --save-dev /path/to/doqa-js/release-dist/doqa-js-dev-0.1.1.tgz
```

```js
// jest.config.cjs
const {withDoqa} = require('doqa-js-dev');
module.exports = withDoqa({testEnvironment: 'node'});
```

Для браузерных тестов указать `jsdom` и установить `jest-environment-jsdom`
той же версии, что Jest. Существующие transforms TypeScript, reporters и hooks сохраняются.
ESM-конфигурация использует `import {withDoqa} from 'doqa-js-dev'`.
ESM-тесты запускаются с необходимыми самой версии Jest флагами VM modules.

Без credentials адаптер пишет Allure-совместимые файлы в `results/`.
Для прямой отправки задать в CI `DOQA_URL`, `DOQA_TOKEN`, `DOQA_SPACE_ID`, затем выполнить
обычную команду `npx jest`. `DOQA_URL` — origin нужного tenant, без `/api`.
Не сохранять токен в репозитории. В DoQA выбрать Jest и способ подключения «Адаптер».

## Разметка

```js
const {doqa} = require('doqa-js-dev');

doqa.test('создание заявки', {
  id: 'REQUEST-CREATE',
  title: 'Пользователь создаёт заявку',
  description: 'Заявка сохраняется и получает номер',
  caseIds: [123],
  labels: {owner: 'requests'},
  tags: ['smoke'],
  links: [{url: 'https://example.org/REQ-1', title: 'Требование'}],
}, async () => {
  await doqa.step('Заполнить форму', async () => {
    doqa.parameter('role', 'user');
    doqa.attach('request.txt', 'демонстрационное вложение', 'text/plain');
  });
});

doqa.test.each([['admin'], ['user']])('роль %s', {id: 'REQUEST-ROLE'}, role => {
  doqa.parameter('role', role);
});
```

Доступны `doqa.test.only`, `.skip`, `.concurrent` и `.each`, `doqa.metadata({...})`,
`doqa.step(title, callback)`, `doqa.attach(name, textOrBytes, mimeType)` и
`doqa.attachFile(path, name?, mimeType?)`. `createManualCase: true` запрашивает
создание ручного кейса согласно серверным правилам. Статическую разметку задавать
при регистрации; runtime-ID использовать только там, где он неизвестен заранее.
`doqa.test` принимает синхронный или Promise callback; callback с `done` оставлять
обычным Jest `test`. API требует стандартного `injectGlobals: true`.

Синхронный `doqa.step` возвращает исходное значение; асинхронный — Promise.
Ошибки callbacks пробрасываются Jest. Контексты concurrent-тестов и вложенных
шагов изолированы. Вне теста/фикстуры шаг выполняет callback, разметка и вложения
не привязываются к случайному тесту.

## Идентичность и план

ID: `metadata.id` → `[DOQA-123]` / `@DOQA:123` в заголовке →
`jest:` + SHA-1 от JSON-массива `[projectId, relativeFile, describeChain, testName]`.
Разделитель пути — `/`. `projectId` по умолчанию равен `displayName.name` Jest либо пустой строке.
Для проектов с одинаковой файловой структурой задавать уникальный `displayName`.
Переименование без явного ID создаёт новую идентичность.

У `doqa.test.each` хэш использует шаблон имени; строки данных имеют общий ID,
но разные параметры и `historyId`. Повторы одной строки сохраняют `historyId`.
У обычного `test.each` адаптер видит раскрытые названия Jest: общей идентичности
исходного шаблона без `doqa.test.each` не обещает. Allure runtime API не перехватывается.

| Режим | Поведение |
| --- | --- |
| `adapterMode: 2` | Создать один прогон для всего запуска Jest |
| `adapterMode: 1` | Отправить результаты в `testRunId` |
| `adapterMode: 0` | Получить план `testRunId` и физически исключить лишние тесты |

Заданный `testRunId` подразумевает режим 1, если режим не указан явно.
Пустой валидный план ничего не выполняет; недоступный план оставляет исходную
выборку Jest с предупреждением. Сопоставление учитывает ID и runner-идентичность,
перед отправкой проверяется окончательный ID. Невыбранные тесты не отправляются
как skipped. Загрузка модулей тестов и регистрация `describe` происходят до отбора.

Для порядка плана добавить `executionOrder: 'plan'`. Требуется режим 0 и план
с `namespace` — относительным путём файла. Файлы исполняются последовательно;
`concurrent`, пользовательский sequencer и перемежение файлов/describe-блоков
отклоняются. Порядок внутри дерева suite сохраняет жизненный цикл hooks.

## Конфигурация и доставка

Приоритет: options второго аргумента `withDoqa` → `DOQA_*` → `doqa.properties` → defaults.
Имена options переводятся в `UPPER_SNAKE_CASE`; путь к properties задаёт `DOQA_CONFIG`.
Properties поддерживает UTF-8 строки `ключ=значение` и комментарии `#`/`!`.

| Options | Default |
| --- | --- |
| `reporting` | `auto`: API при полных credentials, иначе files; также `api`, `files`, `off` |
| `adapterMode`, `resultsDir` | `2`, `results` |
| `batchSize`, `requestTimeoutMs` | `100`, `30000` |
| `retries`, `retryBackoffMs` | `3`, `500` |
| `maxTraceLength`, `maxMessageLength`, `maxParameterLength` | `100000`, `10000`, `2000` |
| `importRealtime`, `certValidation` | `false`, `true` |
| `executionOrder` | `jest` |

Дополнительно: `configurationId`, `testRunName`, `ciRunId`, `pipelineId`, `branch`,
`environment`, `proxy`. Алиасы: `DOQA_PRIVATE_TOKEN`, `DOQA_PROJECT_ID`.
Pipeline/branch подхватываются из GitLab/GitHub переменных.
Proxy и отключение проверки сертификата применяются только к адаптеру, не глобально к Node.js.

Reporter управляет одним прогоном; workers пишут атомарные записи в `.doqa/<session>/`.
В realtime-режиме отправляются законченные файлы тестов: это позволяет включить
`afterAll` в итоговые фикстуры. Каждый чанк содержит единый `report_id`, свой
`chunk_index` и флаг завершения. Upsert выполняется перед результатами, вложения
загружаются заранее. Пустой финальный чанк допустим.

GET и создание прогона с ключом идемпотентности повторяются при временных ошибках;
429 повторяется, остальные неидемпотентные POST при потерянном ответе не повторяются.
После пяти неудач circuit breaker останавливает запросы на 30 секунд.
Ошибка доставки не меняет exit code Jest. Диагностика не содержит токенов и тел ответов.

## Восстановление и ограничения

При ошибке выводится каталог `.doqa/<session>/`: исходные результаты, вложения,
сессия, подготовленные чанки и подтверждения сервера. Не удалять его до разбора.
Allure-файлы сохраняются также при API-доставке. Их можно загрузить существующим
`doqactl`, явно выбрав нужный прогон/CI-корреляцию по его инструкции. При частичной
доставке сначала проверить receipts: повторная загрузка всего каталога не равна
безусловно безопасному повтору потерянного чанка. Архивы не содержат credentials,
но могут содержать чувствительные данные самих тестов.

Для собственного environment экспортировать `wrapEnvironment(YourEnvironment)`
и подключить его через `withDoqa`. Docblock `@jest-environment` должен ссылаться
на обёрнутую среду (`doqa-js-dev/environment-node` или `doqa-js-dev/environment-jsdom`).
Строковые `projects` следует заменить объектными конфигурациями с `withDoqa`.
Watch-режим не входит в первую версию; использовать отдельный процесс Jest на прогон.
Генераторные callbacks не входят в поддерживаемую матрицу.

## Проверки

`npm test` запускает настоящие дочерние процессы Jest: API-контракт с локальным
HTTP-сервером, files, параметры/retries, workers/concurrent, selection, порядок,
hooks, ошибки загрузки, CJS/ESM, jsdom и TypeScript transform. Нужна возможность
слушать loopback-порт. CI проверяет Node.js 22/24 × Jest 29.7/30.x и собирает npm-архив.
Реальные проверки DoQA находятся в соседнем `doqa-e2e`, `fixtures/jest`.

## CI и релизы

Настройка CI, Dependabot и публикации единого пакета описана в
[README doqa-js](../README.md#ci-и-релизы). При переходе с прежнего пакета
замените импорты `doqa-jest-dev` на `doqa-js-dev`; API Jest сохраняется.
