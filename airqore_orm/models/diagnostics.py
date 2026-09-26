from types import SimpleNamespace

from ..fields.types import ForeignKeyField
from ..relations import resolve_relation
from ..schema.state import DeclaredSchemaStateBuilder


class DiagnosticMessage(SimpleNamespace):
    def __init__(self, level, message, model=None, hint=None):
        super().__init__(level=level, message=message, model=model, hint=hint)

    def pretty(self):
        levels = {"warning": "ПРЕДУПРЕЖДЕНИЕ", "error": "ОШИБКА"}
        base = f"{levels.get(self.level, self.level.upper())}: {self.message}"
        if self.model:
            base = f"{base} [{self.model}]"
        if self.hint:
            base = f"{base}\nИсправление: {self.hint}"
        return base


class CompiledModel(SimpleNamespace):
    def __init__(
        self,
        model_name,
        table_name,
        schema,
        auto_table=False,
        auto_schema=False,
        auto_primary_key=False,
        relation_notes=(),
    ):
        super().__init__(
            model_name=model_name,
            table_name=table_name,
            schema=schema,
            auto_table=auto_table,
            auto_schema=auto_schema,
            auto_primary_key=auto_primary_key,
            relation_notes=tuple(relation_notes),
        )


class ModelCompileResult:
    def __init__(self, models, diagnostics, declared_schema=None):
        self.models = tuple(models)
        self.diagnostics = tuple(diagnostics)
        self.declared_schema = declared_schema

    @property
    def tables_resolved(self):
        return tuple(model.table_name for model in self.models)

    @property
    def ok(self):
        return not self.errors

    @property
    def warnings(self):
        return tuple(item for item in self.diagnostics if item.level == "warning")

    @property
    def errors(self):
        return tuple(item for item in self.diagnostics if item.level == "error")

    def pretty(self):
        lines = [
            f"Моделей загружено: {len(self.models)}",
            f"Таблицы: {', '.join(self.tables_resolved) if self.tables_resolved else '-'}",
            f"Проверка: {'успешно' if self.ok else 'ошибка'}",
        ]
        warnings = self.warnings
        errors = self.errors
        if warnings:
            lines.append("Замечания:")
            lines.extend(f"- {item.message}" for item in warnings)
        if errors:
            lines.append("Ошибки:")
            for item in errors:
                lines.append(f"- {item.message}")
                if item.hint:
                    lines.append(f"  Исправление: {item.hint}")
        return "\n".join(lines)


def _inference_notes(meta):
    notes = []
    if getattr(meta, "table_name_was_inferred", False):
        notes.append(f"имя таблицы для {meta.name} определено как {meta.table_name}")
    if getattr(meta, "schema_was_defaulted", False):
        notes.append(f"схема {meta.schema} применена по умолчанию")
    if getattr(meta, "primary_key_was_inferred", False):
        notes.append(f"{meta.name}.id добавлен автоматически как первичный ключ")
    return notes


def _validate_fields(meta):
    diagnostics = []
    for field in meta.fields.values():
        if field.unique and any(item.columns == (field.column,) for item in meta.meta.uniques):
            diagnostics.append(
                DiagnosticMessage(
                    level="warning",
                    model=meta.name,
                    message=f"{meta.name}.{field.name} объявляет unique=True и одновременно указан в Meta.uniques; достаточно флага на поле",
                )
            )
        if isinstance(field, ForeignKeyField) and field.resolve_reference()[0] is None:
            diagnostics.append(
                DiagnosticMessage(
                    level="error",
                    model=meta.name,
                    message=f"{meta.name}.{field.name} ссылается на неизвестную цель {field.reference!r}",
                    hint="Импортируйте целевую модель или используйте корректную ссылку вида '<таблица>.<колонка>'.",
                )
            )
    for message, hint in meta.invalid_fields.values():
        diagnostics.append(
            DiagnosticMessage(level="error", model=meta.name, message=message, hint=hint)
        )
    return diagnostics


def _validate_declared_columns(meta, definitions, option_name):
    diagnostics = []
    for definition in definitions:
        for column in definition.columns:
            if meta.get_field(column) is not None:
                continue
            diagnostics.append(
                DiagnosticMessage(
                    level="error",
                    model=meta.name,
                    message=f"Meta.{option_name} в {meta.name} ссылается на неизвестное поле {column!r}",
                    hint=f"Используйте объявленные поля модели {meta.name} или уберите переопределение.",
                )
            )
    return diagnostics


def _validate_relations(meta, notes):
    diagnostics = []
    for relation in meta.relations.values():
        resolution = resolve_relation(meta, relation)
        notes.extend(resolution.inferred)
        if not resolution.ok:
            diagnostics.append(
                DiagnosticMessage(
                    level="error",
                    model=meta.name,
                    message=resolution.error or f"связь {relation.name} не удалось разрешить",
                    hint=resolution.hint,
                )
            )
    return diagnostics


def compile_models(registry):
    diagnostics = []
    compiled_models = []

    for model in registry.all():
        meta = model._meta
        notes = _inference_notes(meta)
        diagnostics.extend(_validate_fields(meta))
        diagnostics.extend(_validate_declared_columns(meta, meta.meta.indexes, "indexes"))
        diagnostics.extend(_validate_declared_columns(meta, meta.meta.uniques, "uniques"))
        diagnostics.extend(_validate_relations(meta, notes))
        diagnostics.extend(
            DiagnosticMessage(level="warning", model=meta.name, message=note) for note in notes
        )
        compiled_models.append(
            CompiledModel(
                model_name=meta.name,
                table_name=meta.qualified_table,
                schema=meta.schema,
                auto_table=getattr(meta, "table_name_was_inferred", False),
                auto_schema=getattr(meta, "schema_was_defaulted", False),
                auto_primary_key=getattr(meta, "primary_key_was_inferred", False),
                relation_notes=tuple(notes),
            )
        )

    result = ModelCompileResult(models=tuple(compiled_models), diagnostics=tuple(diagnostics))
    result.declared_schema = DeclaredSchemaStateBuilder(registry).build() if result.ok else None
    return result
