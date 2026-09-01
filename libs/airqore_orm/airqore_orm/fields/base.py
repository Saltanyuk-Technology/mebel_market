from ..exceptions import FieldValueError, ModelDeclarationError

_MISSING = object()


class Field:
    python_type = None
    db_type = None

    def __init__(
        self,
        *,
        column=None,
        null=False,
        default=_MISSING,
        primary_key=False,
        unique=False,
        index=False,
        server_default=None,
        auto_now_add=False,
        auto_now=False,
    ):
        self.name = None
        self.column = str(column).strip() if column else None
        self.null = bool(null)
        self.default = default
        self.primary_key = bool(primary_key)
        self.unique = bool(unique)
        self.index = bool(index)
        self.server_default = server_default
        self.auto_now_add = bool(auto_now_add)
        self.auto_now = bool(auto_now)
        self.model = None
        if self.auto_now and self.auto_now_add:
            raise ModelDeclarationError("auto_now и auto_now_add нельзя включать одновременно.")

    def __get__(self, instance, owner):
        if instance is not None:
            return instance.__dict__.get(self.name)
        from ..query.expressions import Column

        return Column(owner, self.name, self.column)

    def __set__(self, instance, value):
        instance.__dict__[self.name] = value

    def clone(self):
        copied = self.__class__.__new__(self.__class__)
        copied.__dict__ = dict(self.__dict__)
        copied.name = None
        copied.model = None
        return copied

    def bind(self, name, model):
        self.name = str(name)
        self.model = model
        if not self.column:
            self.column = self.name
        if (self.auto_now or self.auto_now_add) and self.declared_db_type() != "timestamp":
            raise ModelDeclarationError(
                "auto_now и auto_now_add поддерживаются только DateTimeField."
            )
        return self

    def get_default(self):
        if self.default is _MISSING:
            return None
        if callable(self.default):
            return self.default()
        return self.default

    @property
    def has_default(self):
        return self.default is not _MISSING

    def is_required_on_insert(self):
        if self.primary_key:
            return False
        if self.null:
            return False
        if self.default is not _MISSING:
            return False
        if self.resolved_server_default() is not None:
            return False
        return True

    def serialize(self, value):
        if value is None:
            if not self.null:
                field_label = self.name or "unknown"
                raise FieldValueError(f"Поле {field_label} не допускает None.")
            return value
        expected_type = self.python_type
        if expected_type is not None and not isinstance(value, expected_type):
            expected_name = _format_type_names(expected_type)
            actual_name = type(value).__name__
            field_label = (
                f"{self.model.__name__}.{self.name}"
                if self.model is not None and self.name
                else self.name or "unknown"
            )
            raise FieldValueError(
                f"Поле {field_label} ожидает значение типа {expected_name}, получено {actual_name}.",
            )
        return value

    def declared_db_type(self):
        return self.db_type

    def resolved_server_default(self):
        if self.server_default is not None:
            return self.server_default
        if self.auto_now_add or self.auto_now:
            return "CURRENT_TIMESTAMP"
        return None


def _format_type_names(expected_type):
    if isinstance(expected_type, tuple):
        return " | ".join(item.__name__ for item in expected_type)
    return expected_type.__name__
