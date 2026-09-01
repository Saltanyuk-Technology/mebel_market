# User service

Сервис пользователей, авторизации, профилей и кабинетов. Он владеет таблицами
`users` и `auth_sessions`; другие сервисы не должны изменять их напрямую.

## Архитектура

- `server.py` — создание приложения и запуск HTTP-сервера;
- `configuration.py` — настройки приложения, cookie и Hypercorn;
- `modules/auth` — регистрация, вход, сессии и ORM-репозитории пользователей;
- `modules/user_profile` — личный кабинет и профиль пользователя;
- `modules/company_profile` — кабинет и профиль компании;
- `modules/admin_profile` — кабинет администратора и управление аккаунтами;
- `modules/platform` — публичная страница и проверка состояния сервиса.

Каждый модуль содержит собственные `controller.py`, `service.py` и при
необходимости `helpers.py`, модели и репозитории. Контроллеры только объявляют
маршруты и вызывают сервисные функции.

## API

- `POST /api/auth/register` — `email`, `password`, `firstname`, `secondname`,
  необязательный `phone`, `category` (`user` или `company`).
- `POST /api/auth/login` — `email`, `password`.
- `POST /api/auth/logout`.
- `GET /api/auth/me`.
- `PATCH /api/admin/users/<id>` — включение или отключение аккаунта администратором.

Сессия передается cookie `mebel_session` с флагом `HttpOnly`. Категорию `admin`
невозможно выбрать через публичную регистрацию.

Администратор создается локальной операторской командой (пароль запрашивается без
отображения в терминале):

```powershell
python create_admin.py admin@example.com Имя Фамилия
```
