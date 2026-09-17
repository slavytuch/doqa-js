# DoQA JavaScript

Общий репозиторий JavaScript-интеграций DoQA. Как в `doqa-java`, API-клиент,
общее ядро адаптеров и интеграции с тестовыми фреймворками разделены на модули.
Нужен Node.js 22 или 24. Управление зависимостями — npm workspaces с одним lockfile.

| Модуль | npm-пакет на время разработки | Назначение |
| --- | --- | --- |
| [doqa-client](doqa-client/README.md) | `doqa-js-client-dev` | HTTP, TLS/proxy, таймауты, повторы, circuit breaker |
| [doqa-js-commons](doqa-js-commons/README.md) | `doqa-js-commons-dev` | Конфигурация, модель результатов, шаги и вложения, план, Allure, пакетная отправка |
| [doqa-jest](doqa-jest/README.md) | `doqa-jest-dev` | Jest 29.7/30.x: environment, reporter, sequencer и API разметки |

Зависимости направлены в одну сторону: **Jest → commons → client → undici**.
В client и commons нет зависимостей от Jest. Корень `doqa-js` имеет `private: true`
и не публикуется. Все три модуля выпускаются одной версией; внутренние зависимости
закреплены на точную версию выпуска.

## Сборка и проверки

Все команды выполняются из корня `doqa-js`:

```sh
npm ci
npm run version:check
npm run lint
npm test
npm run pack
npm run test:packages
```

Сборка идёт в порядке client → commons → Jest. `npm test` проверяет HTTP-контракт,
общее ядро без Jest, а затем реальные дочерние процессы Jest: files/API,
параметры/retries, workers/concurrent, selection, порядок, hooks, ошибки загрузки,
CJS/ESM, jsdom и TypeScript. Для API-контракта нужен доступ к loopback-порту.

`npm run pack` создаёт три архива в `release-dist/`. `npm run test:packages`
устанавливает их вместе с Jest в отдельный временный проект из npm, без workspace-ссылок,
и проверяет CJS/ESM, jsdom и содержимое вложения. Нужен доступ к npm registry.

Опубликованная версия `doqa-jest-dev@0.1.0` остаётся доступна в npm. Модульная версия
`0.1.1` готовится к публикации. Пока она не опубликована, для проверки локальной сборки
в проекте тестов установите **все три** архива из `release-dist/` одной командой:

```sh
npm install --save-dev /path/to/doqa-js/release-dist/*.tgz
```

После публикации пользователю достаточно установить `doqa-jest-dev`: client и commons
подтянутся транзитивно. Импорты Jest сохраняются: `require('doqa-jest-dev')` и
`import { doqa, withDoqa } from 'doqa-jest-dev'`.

## CI и Dependabot

CI работает для push в `main` и PR, проверяет Node.js 22/24 × Jest 29.7/30.x,
проверку типов, тесты всех модулей и установку собранных архивов.
Dependabot еженедельно предлагает обновления npm и GitHub Actions через PR;
зависимости Jest объединяются в одну группу. Автоматического слияния нет.

Создайте в GitHub лейблы `type:feature`, `type:bug`, `type:docs`,
`type:dependencies`, `type:internal`, `type:skip-changelog`.
Один из них обязателен для PR, по ним группируются release notes.

## Релизы

Тег `v<версия>` запускает `.github/workflows/release.yml`: проверку единой версии,
матрицу CI, упаковку и проверку архивов, затем публикацию **client → commons → Jest**.
После успешной публикации всех модулей создаётся GitHub Release с тремя архивами.
Суффикс версии, например `0.1.2-rc.1`, выбирает npm-тег `next` и GitHub prerelease;
обычная версия публикуется с npm-тегом `latest`.

Перед автоматической публикацией:

1. Разместите `doqa-js` в GitHub и создайте GitHub Environment `npm`.
2. Новые пакеты `doqa-js-client-dev` и `doqa-js-commons-dev` сначала опубликуйте
   вручную из соответствующих архивов, в указанном порядке, чтобы они появились
   в вашем npm-аккаунте. Затем можно вручную опубликовать архив Jest того же выпуска.
   Не отправляйте для уже вручную опубликованной версии релизный тег: npm запрещает
   повторную публикацию.
3. Для каждого из трёх пакетов в npm настройте Trusted Publisher: фактический
   GitHub owner/repository **doqa-js**, workflow **`release.yml`**, environment **`npm`**,
   с разрешением прямого `npm publish`. Для уже настроенного Jest-пакета укажите новый репозиторий.

Workflow использует OIDC на GitHub-hosted runner, Node.js 24 и npm 11; `NPM_TOKEN`
не требуется. Поля `repository.url` и `repository.directory` в архивах формируются
из фактического GitHub-репозитория и каталога каждого модуля. Для публичного репозитория
npm автоматически добавляет provenance. [Документация npm](https://docs.npmjs.com/trusted-publishers/).

Для следующей версии используйте общую команду, которая обновляет все манифесты,
внутренние зависимости и lockfile:

```sh
npm run version:set -- 0.1.2
npm run version:check
npm test
# Проверьте и закоммитьте изменения релиза.
git tag v0.1.2
git push origin main
git push origin v0.1.2
```

Обычный `npm version` только в одном модуле не подходит: проверка единой версии
отклонит такой релиз. Публикация начинается после отправки тега. Если отдельный job
публикации упал, исправьте причину и повторите только неуспешные jobs: успешно
опубликованные версии повторно отправлять нельзя.

## Добавление адаптера

Добавьте workspace в корневой `package.json` после его зависимостей. Новый адаптер
использует типы результатов, `Runtime` и `Coordinator` из commons, а сам переводит
события своего фреймворка в общую модель. Передайте в coordinator собственные
`name`, `language`, `displayName`, чтобы отчёты не маркировались как Jest.
Добавьте тесты, включите его пакет в проверку архивов и порядок публикации.

## Лицензия

[Apache License 2.0](LICENSE).
