# Airqore ORM

Небольшая асинхронная ORM для PostgreSQL. Основной путь выполнения намеренно прямой:

```text
ORM → Query → Compiler → Session → asyncpg
```

## Модели

```python
from airqore_orm import BooleanField, IntegerField, Model, StringField


class User(Model):
    class Meta:
        table = "users"

    id = IntegerField(primary_key=True)
    email = StringField(unique=True)
    active = BooleanField(default=True)
```

## Подключение и запросы

```python
from airqore_orm import ORM, ORMConfig


orm = ORM(config=ORMConfig.from_env())
await orm.startup()

user = await orm.get(User, id=1)
active_users = await orm.find(User, active=True)
email_taken = await orm.exists(User, email="user@example.com")

users = await (
    orm.select(User)
    .where(User.active == True, User.id > 100)
    .order_by(User.id.desc())
    .limit(50)
    .all()
)

insert = orm.table(User).insert(email="user@example.com", returning=("id", "email"))
created = await orm.fetch_one(insert)

update = orm.table(User).where(id=created["id"]).update(email="new@example.com")
await orm.execute(update)

await orm.shutdown()
```

Simple API и builder создают один и тот же Query AST. Compiler не подключается к БД и
только возвращает SQL с параметрами. Для ручного SQL используются параметры `asyncpg`:

```python
rows = await orm.fetch_all("SELECT id FROM users WHERE email = $1", "user@example.com")
```

## Транзакции

```python
async with orm.transaction() as session:
    await session.execute("UPDATE accounts SET balance = balance - $1 WHERE id = $2", 100, 1)
    await session.execute("UPDATE accounts SET balance = balance + $1 WHERE id = $2", 100, 2)
```

Одна транзакция удерживает одно соединение. Отдельные SQL-запросы автоматически не
повторяются. Для deadlock и serialization failure можно явно повторить всю операцию:

```python
async def transfer(session):
    await session.execute("UPDATE accounts SET balance = balance - $1 WHERE id = $2", 100, 1)
    await session.execute("UPDATE accounts SET balance = balance + $1 WHERE id = $2", 100, 2)


await orm.run_transaction(transfer, attempts=3, deadline=5.0)
```

## Pagination и bulk

Для больших таблиц используйте keyset pagination:

```python
rows = await orm.select(User).page_after(User.id, last_id, size=100).all()
```

`bulk_insert()` делит general SQL на batch. Вставка без `RETURNING` и `UPSERT` использует
`asyncpg.copy_records_to_table()`:

```python
query = orm.table(User).bulk_insert(rows, batch_size=1000)
await orm.execute(query)
```

## Relations

To-one связи выбираются JOIN. To-many загружаются одним batched-запросом:

```python
children_by_parent = await orm.prefetch_many(parents, Parent, "children")
```

Граф связей строится из metadata моделей. `pg_catalog` и `information_schema` используются
только schema tooling.

## Observability

Core не зависит от OpenTelemetry. При необходимости передайте синхронный hook:

```python
def observe(event, attributes):
    metrics.record(event, attributes)


orm = ORM(config=config, event_hook=observe)
```

События: `db.pool.wait_ms`, `db.query.duration_ms`, `db.query.slow`, `db.query.error`,
`db.query.timeout`, `db.transaction.duration_ms`, `db.transaction.timeout`, `db.retry`.

## Схема

`schema_mode="off"` используется по умолчанию. Запуск приложения не выполняет DDL.

Проверка схемы включается явно:

```python
ORMConfig(..., schema_mode="verify")
```

Изменения схемы выполняются отдельной командой или явным вызовом tooling API:

```python
result = await orm.schema.plan()
print(result.pretty())  # SAFE / REQUIRES_LOCK / DESTRUCTIVE / MANUAL
print(result.render_sql())

await orm.schema.apply(allow_destructive=False)
```

Модели с `Meta.managed = False` не входят в declared schema. Неизвестные таблицы PostgreSQL ORM не удаляет.

## Quart

Интеграция не импортируется ядром:

```python
from airqore_orm.integrations.quart import install_orm

orm = install_orm(app, config=ORMConfig.from_env())
```
