import os
from pathlib import Path

from .exceptions import ORMConfigurationError

DEFAULT_DB_PORT = 5432
DEFAULT_DB_POOL_MIN = 5
DEFAULT_DB_POOL_MAX = 20
DEFAULT_DB_CONNECT_TIMEOUT = 5.0
DEFAULT_DB_RETRY_BASE_DELAY = 0.05
DEFAULT_DB_RETRY_MAX_DELAY = 1.0
DEFAULT_DB_TRANSACTION_ATTEMPTS = 1
DEFAULT_DB_APPLICATION_NAME = "airqore-orm"
DEFAULT_DB_ACQUIRE_TIMEOUT = 5.0
DEFAULT_DB_BULK_BATCH_SIZE = 1000
DEFAULT_ORM_SCHEMA_MODE = "off"


def load_dotenv(path=".env", override=False):
    path = Path(path)
    if not path.exists():
        return {}

    loaded = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if not name:
            continue

        # Кавычки в .env нужны только для записи. В само значение они не входят.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        loaded[name] = value
        if override or name not in os.environ:
            os.environ[name] = value
    return loaded


class ORMConfig:
    def __init__(
        self,
        host="",
        user="",
        password="",
        database="",
        port=5432,
        min_size=5,
        max_size=20,
        max_inactive_connection_lifetime=60.0,
        command_timeout=None,
        connect_timeout=5.0,
        statement_cache_size=100,
        max_cached_statement_lifetime=300,
        transaction_attempts=1,
        retry_base_delay=0.05,
        retry_max_delay=1.0,
        application_name="airqore-orm",
        acquire_timeout=5.0,
        bulk_batch_size=1000,
        slow_query_ms=None,
        schema_mode="off",
    ):
        self.host = host
        self.user = user
        self.password = password
        self.database = database
        self.port = port
        self.min_size = min_size
        self.max_size = max_size
        self.max_inactive_connection_lifetime = max_inactive_connection_lifetime
        self.command_timeout = command_timeout
        self.connect_timeout = connect_timeout
        self.statement_cache_size = statement_cache_size
        self.max_cached_statement_lifetime = max_cached_statement_lifetime
        self.transaction_attempts = transaction_attempts
        self.retry_base_delay = retry_base_delay
        self.retry_max_delay = retry_max_delay
        self.application_name = application_name
        self.acquire_timeout = acquire_timeout
        self.bulk_batch_size = bulk_batch_size
        self.slow_query_ms = slow_query_ms
        self.schema_mode = schema_mode

    def validate(self):
        missing = [name for name in ("user", "database") if not getattr(self, name)]
        if missing:
            names = ", ".join(missing)
            raise ORMConfigurationError(
                f"Конфигурация БД заполнена не полностью. Отсутствуют параметры: {names}."
            )
        if self.min_size < 0 or self.max_size <= 0 or self.min_size > self.max_size:
            raise ORMConfigurationError("Некорректно настроены размеры пула соединений.")
        if self.acquire_timeout <= 0 or self.connect_timeout <= 0:
            raise ORMConfigurationError("Значения таймаутов должны быть положительными.")
        if self.command_timeout is not None and self.command_timeout <= 0:
            raise ORMConfigurationError("Таймаут запроса должен быть положительным.")
        if self.transaction_attempts < 1:
            raise ORMConfigurationError("Число попыток транзакции должно быть не меньше одной.")
        if self.retry_base_delay <= 0 or self.retry_max_delay <= 0:
            raise ORMConfigurationError("Задержки retry должны быть положительными.")
        if self.bulk_batch_size < 1:
            raise ORMConfigurationError("Размер batch должен быть не меньше одной строки.")
        if self.slow_query_ms is not None and self.slow_query_ms <= 0:
            raise ORMConfigurationError("Порог медленного запроса должен быть положительным.")
        return self

    def to_asyncpg_kwargs(self):
        options = {
            "user": self.user,
            "database": self.database,
            "port": self.port,
            "min_size": self.min_size,
            "max_size": self.max_size,
            "max_inactive_connection_lifetime": self.max_inactive_connection_lifetime,
            "statement_cache_size": self.statement_cache_size,
            "max_cached_statement_lifetime": self.max_cached_statement_lifetime,
            "timeout": self.connect_timeout,
            "server_settings": {"application_name": self.application_name},
        }
        if self.host:
            options["host"] = self.host
        if self.password:
            options["password"] = self.password
        if self.command_timeout is not None:
            options["command_timeout"] = self.command_timeout
        return options

    @classmethod
    def from_env(cls):
        load_dotenv()
        command_timeout = os.environ.get("DB_COMMAND_TIMEOUT")
        slow_query_ms = os.environ.get("DB_SLOW_QUERY_MS")
        config = cls(
            host=os.environ.get("DB_HOST", ""),
            user=os.environ.get("DB_USER", ""),
            password=os.environ.get("DB_PASSWORD", ""),
            database=os.environ.get("DB_NAME", ""),
            port=int(os.environ.get("DB_PORT", DEFAULT_DB_PORT)),
            min_size=int(os.environ.get("DB_POOL_MIN", DEFAULT_DB_POOL_MIN)),
            max_size=int(os.environ.get("DB_POOL_MAX", DEFAULT_DB_POOL_MAX)),
            command_timeout=float(command_timeout) if command_timeout else None,
            connect_timeout=float(os.environ.get("DB_CONNECT_TIMEOUT", DEFAULT_DB_CONNECT_TIMEOUT)),
            transaction_attempts=int(
                os.environ.get("DB_TRANSACTION_ATTEMPTS", DEFAULT_DB_TRANSACTION_ATTEMPTS)
            ),
            retry_base_delay=float(
                os.environ.get("DB_RETRY_BASE_DELAY", DEFAULT_DB_RETRY_BASE_DELAY)
            ),
            retry_max_delay=float(os.environ.get("DB_RETRY_MAX_DELAY", DEFAULT_DB_RETRY_MAX_DELAY)),
            application_name=os.environ.get("DB_APPLICATION_NAME", DEFAULT_DB_APPLICATION_NAME),
            acquire_timeout=float(os.environ.get("DB_ACQUIRE_TIMEOUT", DEFAULT_DB_ACQUIRE_TIMEOUT)),
            bulk_batch_size=int(os.environ.get("DB_BULK_BATCH_SIZE", DEFAULT_DB_BULK_BATCH_SIZE)),
            slow_query_ms=float(slow_query_ms) if slow_query_ms else None,
            schema_mode=os.environ.get("ORM_SCHEMA_MODE", DEFAULT_ORM_SCHEMA_MODE),
        )
        return config.validate()


def resolve_orm_config(source=None):
    if isinstance(source, ORMConfig):
        return source.validate()
    if source is None:
        return ORMConfig.from_env()
    return ORMConfig(**dict(source)).validate()
