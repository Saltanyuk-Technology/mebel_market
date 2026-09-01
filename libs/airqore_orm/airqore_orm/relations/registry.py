from collections import defaultdict
from types import SimpleNamespace

from ..naming import normalize_identifier
from .base import resolve_relation


def _singular(name):
    word = str(name).split(".")[-1].lower()
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith("s"):
        return word[:-1]
    return word


class TableRelation(SimpleNamespace):
    def __init__(
        self,
        source_table,
        target_table,
        source_columns,
        target_columns,
        name,
        kind="belongs_to",
        alias=None,
        labels=(),
    ):
        super().__init__(
            source_table=source_table,
            target_table=target_table,
            source_columns=tuple(source_columns),
            target_columns=tuple(target_columns),
            name=name,
            kind=kind,
            alias=alias,
            labels=tuple(labels),
        )

    @property
    def local_key(self):
        return self.source_columns[0] if len(self.source_columns) == 1 else None

    def matches(self, name):
        candidate = normalize_identifier(name)
        return candidate == normalize_identifier(self.name) or candidate in {
            normalize_identifier(label) for label in self.labels
        }


class RelationRegistry:
    def __init__(self, registry=None):
        if registry is None:
            from ..models import model_registry

            registry = model_registry
        self.models = registry
        self._manual = defaultdict(list)
        self._declared = ()
        self._model_revision = -1

    def register(
        self,
        source_table,
        target_table,
        *,
        name=None,
        local_key=None,
        foreign_key="id",
        reverse=False,
        alias=None,
    ):
        source = normalize_identifier(source_table)
        target = normalize_identifier(target_table)
        relation_name = name or _singular(target)
        if reverse:
            source_columns = (foreign_key,)
            target_columns = (local_key or f"{_singular(source)}_id",)
            kind = "has_many"
        else:
            source_columns = (local_key or f"{_singular(target)}_id",)
            target_columns = (foreign_key,)
            kind = "belongs_to"
        relation = TableRelation(
            source,
            target,
            source_columns,
            target_columns,
            relation_name,
            kind=kind,
            alias=alias,
            labels=(target, _singular(target)),
        )
        self._manual[source].append(relation)
        return relation

    def relations_for(self, source_table):
        source = normalize_identifier(source_table)
        declared = [item for item in self._declared_relations() if item.source_table == source]
        return tuple(self._manual.get(source, ())) + tuple(declared)

    def resolve(self, source_table, relation_name):
        return next(
            (
                relation
                for relation in self.relations_for(source_table)
                if relation.matches(relation_name)
            ),
            None,
        )

    def find_target(self, source_table, target_table):
        target = normalize_identifier(target_table)
        return next(
            (
                relation
                for relation in self.relations_for(source_table)
                if relation.target_table == target
            ),
            None,
        )

    def _declared_relations(self):
        revision = getattr(self.models, "revision", None)
        if revision is not None and revision == self._model_revision:
            return self._declared
        # Связи строятся из моделей заново только после регистрации новой модели.
        relations = []
        for model in self.models.all():
            source_meta = model._meta
            for declaration in source_meta.relations.values():
                resolution = resolve_relation(source_meta, declaration)
                target_meta = declaration.resolve_target_meta()
                if not resolution.ok or target_meta is None:
                    continue
                labels = tuple(
                    filter(
                        None,
                        (
                            declaration.related_name,
                            target_meta.table_name,
                            target_meta.name.lower(),
                        ),
                    )
                )
                relations.append(
                    TableRelation(
                        source_meta.qualified_table,
                        target_meta.qualified_table,
                        (source_meta.require_field(resolution.local_key).column,),
                        (target_meta.require_field(resolution.foreign_key).column,),
                        declaration.name,
                        kind=declaration.kind,
                        labels=labels,
                    )
                )
        self._declared = tuple(relations)
        self._model_revision = revision
        return self._declared
