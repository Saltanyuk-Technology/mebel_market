# Mebel Market

Проект организован как набор независимо запускаемых сервисов:

- `services/user-service` — пользователи, авторизация, профили и кабинеты;
- `services/constructor-service` — Quart-сервис конструктора и его frontend;
- `services/editor-service` — Quart-сервис редактора, его frontend и общий API;
- `services/editor-service/modules/api` — API предметных данных редактора и конструктора внутри сервиса редактора;
- `airqore_orm` — локальная ORM-библиотека, входящая в репозиторий;
- корневой `server.py` — оркестратор для одновременного запуска всех сервисов.

## Установка

```powershell
pip install -r requirements.txt
```

Three.js хранится локально в `static/vendor` каждого инструмента и обслуживается
Quart как обычные браузерные ES-модули.

Локальная ORM находится в корне репозитория и подключается оркестратором через
`PYTHONPATH`; наличие отдельного внешнего репозитория не требуется.

Для проекта используется локальный PostgreSQL на `127.0.0.1:5432`. Параметры
подключения задаются в `.env`.

## Запуск всех сервисов

```powershell
python server.py
```

Команда поднимает три Quart-процесса: пользовательский сервис на порту `8080`,
редактор вместе с API на `8081` и конструктор на `8082`. Сервисы автоматически
перезапускаются при изменении исходных файлов. Нажатие `Ctrl+C` останавливает все
три процесса.

## Раздельный запуск

Каждый сервис остается полностью самостоятельным:

```powershell
# User service
Set-Location services/user-service
$env:PYTHONPATH = (Resolve-Path ../..).Path
python server.py

# Constructor
Set-Location services/constructor-service
$env:PYTHONPATH = (Resolve-Path ../..).Path
python server.py

# Editor
Set-Location services/editor-service
$env:PYTHONPATH = (Resolve-Path ../..).Path
python server.py
```

API редактора использует отдельные переменные `EDITOR_DB_*` и отдельную PostgreSQL-базу
`mebel_editor`. Адрес пользовательского сервиса для проверки сессий задаётся через
`USER_SERVICE_URL`.

Пустые базы создаются и получают схему командами:

```powershell
python manage_sql.py --load_sql --sql-file base.sql --db-name mebel_market
python manage_sql.py --load_sql --sql-file second_base.sql --db-name mebel_editor
```
