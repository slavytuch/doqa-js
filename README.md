# DoQA JavaScript

Единый npm-пакет `doqa-js-dev`: HTTP-клиент DoQA, общее ядро адаптеров и интеграция
с Jest 29.7/30.x. Требуется Node.js 22 или 24.

```sh
npm install --save-dev doqa-js-dev
```

```js
const { withDoqa } = require('doqa-js-dev');
module.exports = withDoqa({ testEnvironment: 'node' }, { reporting: 'files' });
```

В тестах используйте `const { doqa } = require('doqa-js-dev')` или
`import { doqa } from 'doqa-js-dev'`. Настройки, шаги, вложения и отправка результатов
описаны в [руководстве Jest](doqa-jest/README.md).

## Структура

Исходники разделены по назначению, но публикуется **один архив** из корня репозитория.
Отдельных npm-пакетов и workspaces нет. Client и commons включены в пакет;
единственная runtime-зависимость — `undici`. Jest задаётся через peer dependencies.

| Каталог исходников | Импорт из единого пакета | Назначение |
| --- | --- | --- |
| `doqa-client` | `doqa-js-dev/client` | HTTP, TLS/proxy, таймауты и повторы |
| `doqa-js-commons` | `doqa-js-dev/commons` | Конфигурация, результаты, шаги, вложения и Allure |
| `doqa-jest` | `doqa-js-dev` или `doqa-js-dev/jest` | Jest environment, reporter, sequencer и разметка |

Доступны также `doqa-js-dev/reporter`, `doqa-js-dev/environment-node`,
`doqa-js-dev/environment-jsdom`, `doqa-js-dev/sequencer`,
`doqa-js-dev/commons/coordinator` и `doqa-js-dev/commons/session`.
Client и commons не зависят от исходников Jest.

## Сборка и проверки

Из корня репозитория:

```sh
npm ci
npm run version:check
npm run lint
npm test
npm run pack
npm run test:packages
```

Тесты проверяют HTTP-контракт, общее ядро, реальные процессы Jest, CJS/ESM, jsdom,
TypeScript, параметры, retries, workers, планы, шаги и вложения. Для HTTP-тестов
нужен доступ к loopback-порту. Проверка архивов устанавливает один пакет в отдельный
временный проект из npm и проверяет CJS/ESM, jsdom и содержимое вложения.

`npm run pack` создаёт `release-dist/doqa-js-dev-<версия>.tgz`.
Для локальной проверки в `doqa-jest-integration-tests`:

```sh
npm install --save-dev ../doqa-js/release-dist/doqa-js-dev-0.1.1.tgz
npm test
```

## CI и релизы

CI проверяет Node.js 22/24 × Jest 29.7/30.x, типы, тесты и установку архива.
Dependabot предлагает обновления npm и GitHub Actions через PR.
Лейблы PR: `type:feature`, `type:bug`, `type:docs`, `type:dependencies`,
`type:internal`, `type:skip-changelog`.

Первый выпуск `doqa-js-dev` публикуется вручную из проверенного архива:

```sh
npm publish ./release-dist/doqa-js-dev-0.1.1.tgz --access public --tag latest
```

Для следующих автоматических выпусков настройте GitHub Environment `npm` и
npm Trusted Publisher для пакета `doqa-js-dev`: owner `slavytuch`, repository
`doqa-js`, workflow `release.yml`, environment `npm` с разрешением прямой публикации.
Workflow использует OIDC, Node.js 24 и npm 11; `NPM_TOKEN` не требуется.

```sh
npm run version:set -- 0.1.2
npm run version:check
npm test
# Проверьте и закоммитьте изменения релиза.
git tag v0.1.2
git push origin main
git push origin v0.1.2
```

Тег запускает CI, упаковку, проверку одного архива, публикацию и GitHub Release.
Обычная версия получает npm-тег `latest`, версия с суффиксом — `next` и GitHub prerelease.
Не отправляйте релизный тег для уже опубликованной вручную версии: npm запрещает
повторную публикацию той же версии.

## Лицензия

[Apache License 2.0](LICENSE).
