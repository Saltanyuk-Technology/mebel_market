from types import SimpleNamespace

from ..naming import normalize_identifier


class IndexDefinition(SimpleNamespace):
    def __init__(self, columns, name=None, unique=False):
        super().__init__(columns=tuple(columns), name=name, unique=bool(unique))


class UniqueConstraintDefinition(SimpleNamespace):
    def __init__(self, columns, name=None):
        super().__init__(columns=tuple(columns), name=name)


class CheckConstraint(SimpleNamespace):
    def __init__(self, expression, name=None):
        super().__init__(expression=str(expression), name=name)


class MetaOptions:
    def __init__(
        self,
        model=None,
        model_name="",
        table="",
        schema="public",
        managed=True,
        indexes=(),
        uniques=(),
        constraints=(),
    ):
        self.model = model
        self.model_name = model_name
        self.table = table
        self.schema = schema
        self.managed = managed
        self.indexes = tuple(indexes)
        self.uniques = tuple(uniques)
        self.constraints = tuple(constraints)

    @classmethod
    def from_declared(cls, model, declared_meta):
        declared_meta = declared_meta or object
        table = getattr(model, "__table__", None) or getattr(declared_meta, "table", "")
        schema = getattr(declared_meta, "schema", "public")

        indexes = []
        for value in getattr(declared_meta, "indexes", ()):
            if isinstance(value, IndexDefinition):
                indexes.append(value)
            else:
                columns = (value,) if isinstance(value, str) else value
                indexes.append(IndexDefinition(columns))

        uniques = []
        for value in getattr(declared_meta, "uniques", ()):
            if isinstance(value, UniqueConstraintDefinition):
                uniques.append(value)
            else:
                columns = (value,) if isinstance(value, str) else value
                uniques.append(UniqueConstraintDefinition(columns))

        constraints = []
        for value in getattr(declared_meta, "constraints", ()):
            if not isinstance(value, CheckConstraint):
                value = CheckConstraint(value)
            constraints.append(value)

        return cls(
            model=model,
            model_name=model.__name__,
            table=normalize_identifier(table or model.__name__),
            schema=normalize_identifier(schema or "public"),
            managed=bool(getattr(declared_meta, "managed", True)),
            indexes=indexes,
            uniques=uniques,
            constraints=constraints,
        )
