# Mebel Market

Проект организован как набор независимо запускаемых сервисов:

- `services/user-service` — пользователи, авторизация, профили и кабинеты;
- `services/constructor-service` — клиент конструктора;
- `services/editor-service` — клиент редактора;
- `services/editor-service/api` — независимый API предметных данных редактора и конструктора;
- `libs/airqore_orm` — локальная ORM-библиотека, входящая в репозиторий;
- корневой `server.py` — оркестратор для одновременного запуска всех сервисов.

## Установка

```powershell
pip install -r requirements.txt
pnpm --dir services/constructor-service install
pnpm --dir services/editor-service install
```

Если `pnpm` не установлен, используйте входящий в Node.js менеджер `npm`:

```powershell
npm --prefix services/constructor-service install
npm --prefix services/editor-service install
```

Оркестратор автоматически выбирает доступный `pnpm` или `npm`.

`pip install -r requirements.txt` устанавливает ORM из `libs/airqore_orm`; наличие
соседней папки `work/airqore-orm` не требуется.

Для проекта используется локальный PostgreSQL на `127.0.0.1:5432`. Параметры
подключения задаются в `.env`.

## Запуск всех сервисов

```powershell
python server.py
```

Команда поднимает пользовательский сервис на порту `8080`, API редактора на `8081`,
конструктор на `5173` и редактор на `5174`. Python-сервисы автоматически
перезапускаются при изменении исходных файлов, а Vite обновляет frontend-сервисы.
Нажатие `Ctrl+C` останавливает все четыре процесса.

## Раздельный запуск

Каждый сервис остается полностью самостоятельным:

```powershell
# User service
Set-Location services/user-service
python server.py

# Constructor
Set-Location services/constructor-service
pnpm dev
# либо: npm run dev

# Editor
Set-Location services/editor-service
pnpm dev
# либо: npm run dev

# Editor API (в отдельном окне)
Set-Location services/editor-service
python -m api.server
```

API редактора использует отдельные переменные `EDITOR_DB_*` и отдельную PostgreSQL-базу
`mebel_editor`. Адрес пользовательского сервиса для проверки сессий задаётся через
`USER_SERVICE_URL`.

Для локального PostgreSQL база создаётся один раз командой:

```powershell
Set-Location services/editor-service
python -m api.create_database
```

При использовании Docker Compose поднимаются два независимых контейнера PostgreSQL:
пользовательская база на порту `5433` и база редактора на порту `5434`.

Существующие проекты переносятся без изменения исходной базы. Команды запускаются из
`services/editor-service` при настроенных `DB_*` и `EDITOR_DB_*`:

```powershell
python -m api.migrate_legacy --dry-run
python -m api.migrate_legacy
python -m api.migrate_legacy --verify-only
```

Повторный запуск безопасен: UUID и контрольные суммы уже перенесённых записей сохраняются.
Для точечного переноса доступен параметр `--source-project-id UUID`.

Архитектура и эксплуатация описаны в [Editor API](docs/editor-api.md),
[переносе данных](docs/data-migration.md) и [расширении каталога](docs/catalog-extension.md).
