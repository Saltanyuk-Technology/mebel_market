# Mebel Market

Проект организован как набор независимо запускаемых сервисов:

- `services/user-service` — пользователи, авторизация, профили и кабинеты;
- `services/constructor-service` — клиент конструктора;
- `services/editor-service` — клиент редактора;
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

Команда поднимает пользовательский сервис на постоянном порту `8080`, конструктор на `5173` и редактор на
`5174`. Auth автоматически перезапускается при изменении Python, HTML, CSS и
JavaScript-файлов, а Vite
обновляет frontend-сервисы. Нажатие `Ctrl+C` останавливает все три процесса.

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
```
