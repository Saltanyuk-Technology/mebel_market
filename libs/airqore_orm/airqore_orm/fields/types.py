import json
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from ..exceptions import ModelDeclarationError
from .base import _MISSING, Field


class IntegerField(Field):
    python_type = int
    db_type = "integer"


class BigIntegerField(Field):
    python_type = int
    db_type = "bigint"


class SmallIntegerField(Field):
    python_type = int
    db_type = "smallint"


class StringField(Field):
    python_type = str
    db_type = "text"


class TextField(Field):
    python_type = str
    db_type = "text"


class BooleanField(Field):
    python_type = bool
    db_type = "boolean"


class DateTimeField(Field):
    python_type = datetime
    db_type = "timestamp"


class DateField(Field):
    python_type = date
    db_type = "date"


class TimeField(Field):
    python_type = time
    db_type = "time"


class FloatField(Field):
    python_type = float
    db_type = "double precision"


class NumericField(Field):
    python_type = Decimal
    db_type = "numeric"


class DecimalField(NumericField):
    pass


class JSONField(Field):
    python_type = (dict, list)
    db_type = "json"

    def serialize(self, value):
        value = super().serialize(value)
        if value is None:
            return value
        return json.dumps(value, ensure_ascii=False, default=str)


class JSONBField(Field):
    python_type = (dict, list)
    db_type = "jsonb"

    def serialize(self, value):
        value = super().serialize(value)
        if value is None:
            return value
        return json.dumps(value, ensure_ascii=False, default=str)


class UUIDField(Field):
    python_type = UUID
    db_type = "uuid"


class ArrayField(Field):
    db_type = "array"
    python_type = list

    def __init__(self, base_type, **kwargs):
        super().__init__(**kwargs)
        normalized = str(base_type).strip().lower()
        allowed = {
            "bigint",
            "boolean",
            "date",
            "double precision",
            "integer",
            "numeric",
            "smallint",
            "text",
            "time",
            "timestamp",
            "uuid",
        }
        if normalized not in allowed:
            raise ModelDeclarationError(f"Неподдерживаемый тип массива: {base_type!r}.")
        self.base_type = normalized

    def declared_db_type(self):
        return f"{self.base_type}[]"

    def serialize(self, value):
        value = super().serialize(value)
        if value is None:
            return value
        return list(value)


class ForeignKeyField(Field):
    def __init__(
        self,
        reference,
        *,
        column=None,
        null=False,
        default=_MISSING,
        unique=False,
        on_delete="no action",
        on_update="no action",
    ):
        super().__init__(column=column, null=null, default=default, unique=unique)
        self.reference = reference
        self.on_delete = _foreign_key_action(on_delete)
        self.on_update = _foreign_key_action(on_update)

    def serialize(self, value):
        value = super().serialize(value)
        if value is None:
            return None
        target_field = self._target_field()
        return target_field.serialize(value) if target_field is not None else value

    def _target_field(self):
        from ..models import Model, model_registry

        if isinstance(self.reference, type) and issubclass(self.reference, Model):
            model = self.reference
        else:
            model = model_registry.resolve(self.reference)
        if model is None:
            return None
        target_pk = model._meta.primary_key or "id"
        return model._meta.require_field(target_pk)

    def resolve_reference(self):
        if isinstance(self.reference, str):
            reference = self.reference.strip()
            if "." in reference:
                table_name, column_name = reference.rsplit(".", 1)
                return table_name.lower(), column_name

        target_field = self._target_field()
        if target_field is None:
            return None, None
        return target_field.model._meta.qualified_table, target_field.column

    def declared_db_type(self):
        target_field = self._target_field()
        if target_field is not None:
            return target_field.declared_db_type() or target_field.db_type
        return "integer"


def _foreign_key_action(value):
    normalized = str(value).strip().lower().replace("_", " ")
    allowed = {"no action", "restrict", "cascade", "set null", "set default"}
    if normalized not in allowed:
        raise ModelDeclarationError(f"Неподдерживаемое действие внешнего ключа: {value!r}.")
    return normalized
