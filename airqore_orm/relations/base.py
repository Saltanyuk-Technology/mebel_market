from types import SimpleNamespace


class RelationResolution(SimpleNamespace):
    def __init__(
        self,
        relation_name,
        kind,
        source_model,
        target_model,
        local_key=None,
        foreign_key=None,
        inferred=(),
        error=None,
        hint=None,
    ):
        super().__init__(
            relation_name=relation_name,
            kind=kind,
            source_model=source_model,
            target_model=target_model,
            local_key=local_key,
            foreign_key=foreign_key,
            inferred=tuple(inferred),
            error=error,
            hint=hint,
        )

    @property
    def ok(self):
        return self.error is None


def _target_fk_candidates(reference_meta, search_meta):
    from ..fields.types import ForeignKeyField
    from ..naming import normalize_identifier

    target_tables = {
        normalize_identifier(reference_meta.table_name),
        normalize_identifier(reference_meta.qualified_table),
    }
    matches = []
    for field in search_meta.fields.values():
        if not isinstance(field, ForeignKeyField):
            continue
        table_name, _column_name = field.resolve_reference()
        if table_name is None:
            continue
        if normalize_identifier(table_name) in target_tables:
            matches.append(field.name)
    return tuple(matches)


def resolve_relation(model_meta, relation):
    target_meta = relation.resolve_target_meta()
    if target_meta is None:
        target_label = getattr(relation.target, "__name__", relation.target)
        return RelationResolution(
            relation_name=relation.name or "",
            kind=relation.kind,
            source_model=model_meta.name,
            target_model=str(target_label),
            error=f"цель связи {target_label!r} не удалось разрешить",
            hint="Убедитесь, что целевая модель импортирована до компиляции схемы.",
        )

    if relation.kind == "belongs_to":
        return _resolve_belongs_to(model_meta, target_meta, relation)

    if relation.kind in {"has_one", "has_many"}:
        return _resolve_reverse_relation(model_meta, target_meta, relation)

    return RelationResolution(
        relation_name=relation.name or "",
        kind=relation.kind,
        source_model=model_meta.name,
        target_model=target_meta.name,
        local_key=relation.local_key,
        foreign_key=relation.foreign_key,
    )


def _relation_error(model_meta, target_meta, relation, message, hint):
    return RelationResolution(
        relation_name=relation.name or "",
        kind=relation.kind,
        source_model=model_meta.name,
        target_model=target_meta.name,
        error=message,
        hint=hint,
    )


def _resolved_relation(model_meta, target_meta, relation, local_key, foreign_key, notes):
    if model_meta.get_field(local_key) is None:
        return _relation_error(
            model_meta,
            target_meta,
            relation,
            f"локальный ключ {local_key!r} для связи {model_meta.name}.{relation.name} не найден",
            f"Объявите поле {local_key!r} в модели {model_meta.name} или скорректируйте local_key.",
        )
    if target_meta.get_field(foreign_key) is None:
        return _relation_error(
            model_meta,
            target_meta,
            relation,
            f"внешний ключ {foreign_key!r} для связи {model_meta.name}.{relation.name} не найден в {target_meta.name}",
            f"Объявите поле {foreign_key!r} в модели {target_meta.name} или скорректируйте foreign_key.",
        )
    return RelationResolution(
        relation_name=relation.name or "",
        kind=relation.kind,
        source_model=model_meta.name,
        target_model=target_meta.name,
        local_key=local_key,
        foreign_key=foreign_key,
        inferred=tuple(notes),
    )


def _resolve_belongs_to(model_meta, target_meta, relation):
    local_key = relation.local_key
    notes = []
    if local_key is None:
        matches = _target_fk_candidates(target_meta, model_meta)
        if len(matches) > 1:
            return _relation_error(
                model_meta,
                target_meta,
                relation,
                f"модель {model_meta.name} ссылается на {target_meta.name}, но внешний ключ определяется неоднозначно",
                f"Явно укажите local_key для {model_meta.name}.{relation.name}: {', '.join(matches)}",
            )
        if not matches:
            return _relation_error(
                model_meta,
                target_meta,
                relation,
                f"у связи {model_meta.name}.{relation.name} нет подходящего внешнего ключа на {target_meta.name}",
                f'Добавьте ForeignKeyField("{target_meta.name}") или явно укажите local_key.',
            )
        local_key = matches[0]
        notes.append(
            f"связь BelongsTo({target_meta.name}) разрешена через локальный ключ {local_key}"
        )

    foreign_key = relation.foreign_key or target_meta.primary_key or "id"
    return _resolved_relation(
        model_meta, target_meta, relation, local_key, foreign_key, notes
    )


def _resolve_reverse_relation(model_meta, target_meta, relation):
    local_key = relation.local_key or model_meta.primary_key or "id"
    foreign_key = relation.foreign_key if relation.foreign_key not in {None, "", "id"} else None
    notes = []
    if foreign_key is None:
        matches = _target_fk_candidates(model_meta, target_meta)
        if len(matches) > 1:
            return _relation_error(
                model_meta,
                target_meta,
                relation,
                f"у связи {model_meta.name}.{relation.name} несколько обратных внешних ключей в {target_meta.name}",
                f"Явно укажите foreign_key для {model_meta.name}.{relation.name}: {', '.join(matches)}",
            )
        if not matches:
            return _relation_error(
                model_meta,
                target_meta,
                relation,
                f"для связи {model_meta.name}.{relation.name} не удалось найти обратный внешний ключ в {target_meta.name}",
                f'Добавьте ForeignKeyField("{model_meta.name}") в {target_meta.name} или явно укажите foreign_key.',
            )
        foreign_key = matches[0]
        notes.append(
            f"связь {relation.__class__.__name__}({target_meta.name!r}) разрешена через внешний ключ {foreign_key}"
        )

    return _resolved_relation(
        model_meta, target_meta, relation, local_key, foreign_key, notes
    )


class RelationField:
    kind = "relation"
    many = False

    def __init__(
        self,
        target,
        *,
        local_key=None,
        foreign_key="id",
        related_name=None,
    ):
        self.name = None
        self.model = None
        self.target = target
        self.local_key = local_key
        self.foreign_key = foreign_key
        self.related_name = related_name

    def clone(self):
        copied = self.__class__.__new__(self.__class__)
        copied.__dict__ = dict(self.__dict__)
        copied.name = None
        copied.model = None
        return copied

    def bind(self, name, model):
        self.name = str(name)
        self.model = model
        return self

    def resolve_target_meta(self):
        from ..models import model_registry

        model = model_registry.resolve(self.target)
        return model._meta if model is not None else None


class BelongsTo(RelationField):
    kind = "belongs_to"


class HasOne(RelationField):
    kind = "has_one"


class HasMany(RelationField):
    kind = "has_many"
    many = True
