from ..exceptions import QueryBuildError
from ..fields.base import _MISSING, Field
from ..fields.types import IntegerField
from ..naming import camel_to_snake, pluralize, qualified_name
from ..relations.base import RelationField
from .options import MetaOptions


class ModelOptions:
    def __init__(
        self,
        model,
        name,
        table_name,
        schema,
        fields=None,
        relations=None,
        primary_key=None,
        columns=(),
        column_to_field=None,
        invalid_fields=None,
        meta=None,
        table_name_was_inferred=False,
        schema_was_defaulted=False,
        primary_key_was_inferred=False,
    ):
        self.model = model
        self.name = name
        self.table_name = table_name
        self.schema = schema
        self.fields = fields or {}
        self.relations = relations or {}
        self.primary_key = primary_key
        self.columns = tuple(columns)
        self.column_to_field = column_to_field or {}
        self.invalid_fields = invalid_fields or {}
        self.meta = meta
        self.table_name_was_inferred = table_name_was_inferred
        self.schema_was_defaulted = schema_was_defaulted
        self.primary_key_was_inferred = primary_key_was_inferred

    @property
    def qualified_table(self):
        return qualified_name(self.schema, self.table_name)

    def get_field(self, name_or_column):
        key = str(name_or_column).strip()
        if key in self.fields:
            return self.fields[key]
        mapped = self.column_to_field.get(key)
        if mapped is None:
            return None
        return self.fields.get(mapped)

    def require_field(self, name_or_column):
        field = self.get_field(name_or_column)
        if field is None:
            raise QueryBuildError(
                f"Неизвестное поле '{name_or_column}' для модели {self.model.__name__}."
            )
        return field


class ModelRegistry:
    def __init__(self):
        self._models = {}
        self.revision = 0

    def register(self, model):
        meta = model._meta
        keys = (
            model.__name__,
            f"{model.__module__}.{model.__name__}",
            meta.table_name,
            meta.qualified_table,
        )
        for key in keys:
            self._models[str(key).strip().lower()] = model
        self.revision += 1
        return model

    def resolve(self, reference):
        if reference is None:
            return None
        if isinstance(reference, type) and issubclass(reference, Model):
            return reference
        return self._models.get(str(reference).strip().lower())

    def all(self):
        return tuple(dict.fromkeys(self._models.values()))

    def compile(self):
        from .diagnostics import compile_models

        return compile_models(self)


model_registry = ModelRegistry()


def _collect_model_declarations(name, bases, attrs):
    fields = {}
    relations = {}
    invalid_fields = {}

    for base in bases:
        base_meta = getattr(base, "_meta", None)
        if base_meta is None:
            continue
        fields.update({key: value.clone() for key, value in base_meta.fields.items()})
        relations.update({key: value.clone() for key, value in base_meta.relations.items()})
        invalid_fields.update(base_meta.invalid_fields)

    for attr_name, attr_value in attrs.items():
        if (
            isinstance(attr_value, tuple)
            and len(attr_value) == 1
            and isinstance(attr_value[0], Field)
        ):
            field_type = attr_value[0].__class__.__name__
            invalid_fields[attr_name] = (
                f"{name}.{attr_name} объявлено некорректно: после {field_type}(...) стоит лишняя запятая, поэтому атрибут стал tuple вместо поля ORM.",
                f"Уберите запятую: {attr_name} = {field_type}(...)",
            )

    own_fields = {key: value for key, value in attrs.items() if isinstance(value, Field)}
    own_relations = {key: value for key, value in attrs.items() if isinstance(value, RelationField)}
    for key in own_fields.keys() | own_relations.keys():
        attrs.pop(key)
    fields.update(own_fields)
    relations.update(own_relations)
    return fields, relations, invalid_fields


def _build_model_options(model, name, meta_cls, fields, relations, invalid_fields):
    meta = MetaOptions.from_declared(model, meta_cls)
    declared_table = meta.table
    table_was_inferred = not meta.table or meta.table == name.lower()
    if table_was_inferred:
        meta.table = pluralize(camel_to_snake(name))

    primary_key_was_inferred = (
        not any(field.primary_key for field in fields.values()) and "id" not in fields
    )
    if primary_key_was_inferred:
        fields = {"id": IntegerField(primary_key=True).bind("id", model), **fields}

    primary_keys = [field.name for field in fields.values() if field.primary_key]
    if len(primary_keys) > 1:
        raise QueryBuildError(
            f"Модель {name} объявляет несколько первичных ключей. Составные PK пока не поддерживаются."
        )

    options = ModelOptions(
        model=model,
        name=name,
        table_name=meta.table,
        schema=meta.schema,
        fields=fields,
        relations=relations,
        primary_key=primary_keys[0] if primary_keys else None,
        columns=tuple(field.column for field in fields.values()),
        column_to_field={field.column: field.name for field in fields.values()},
        invalid_fields=invalid_fields,
        meta=meta,
        table_name_was_inferred=table_was_inferred or not declared_table,
        schema_was_defaulted=not bool(getattr(meta_cls, "schema", None)),
        primary_key_was_inferred=primary_key_was_inferred,
    )
    return options


class ModelMeta(type):
    def __new__(mcls, name, bases, attrs):
        meta_cls = attrs.get("Meta")
        fields, relations, invalid_fields = _collect_model_declarations(name, bases, attrs)
        cls = super().__new__(mcls, name, bases, attrs)
        if name == "Model" and cls.__module__ == __name__:
            return cls

        for field_name, field in fields.items():
            fields[field_name] = field.bind(field_name, cls)
            setattr(cls, field_name, field)
        for relation_name, relation in relations.items():
            relations[relation_name] = relation.bind(relation_name, cls)
            setattr(cls, relation_name, None)
        cls._meta = _build_model_options(cls, name, meta_cls, fields, relations, invalid_fields)
        model_registry.register(cls)
        return cls


class Model(metaclass=ModelMeta):
    __table__ = None

    def __init__(self, **values):
        meta = self._meta
        extras = {}
        for name, field_obj in meta.fields.items():
            value = _MISSING
            if name in values:
                value = values.pop(name)
            elif field_obj.column in values:
                value = values.pop(field_obj.column)
            if value is _MISSING:
                value = field_obj.get_default()
            setattr(self, name, value)
        for key, value in values.items():
            extras[key] = value
            setattr(self, key, value)
        self._extras = extras

    @classmethod
    def from_row(cls, row):
        if row is None:
            return None
        payload = {}
        extras = {}
        items = row.items() if isinstance(row, dict) else dict(row).items()
        for key, value in items:
            field_obj = cls._meta.get_field(key)
            if field_obj is None:
                extras[key] = value
                continue
            payload[field_obj.name] = value
        instance = cls(**payload)
        for key, value in extras.items():
            setattr(instance, key, value)
        instance._extras = extras
        return instance

    def to_dict(self, *, by_alias=False, include_none=True):
        payload = {}
        for name, field_obj in self._meta.fields.items():
            value = getattr(self, name, None)
            if value is None and not include_none:
                continue
            payload[field_obj.column if by_alias else name] = value
        payload.update(getattr(self, "_extras", {}))
        return payload

    def __repr__(self):
        values = ", ".join(f"{name}={getattr(self, name, None)!r}" for name in self._meta.fields)
        return f"{self.__class__.__name__}({values})"


def is_model_class(value):
    return isinstance(value, type) and issubclass(value, Model)


def get_model_meta(value):
    model = value if is_model_class(value) else model_registry.resolve(value)
    if model is None:
        return None
    return model._meta
