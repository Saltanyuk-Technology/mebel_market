import json

from ..exceptions import ORMConfigurationError
from .diff import build_schema_plan, ensure_destructive_allowed
from .history import MigrationHistoryStore
from .inspect import introspect_database_metadata
from .state import DeclaredSchemaStateBuilder


class SchemaPlanResult:
    def __init__(self, model_result, plan, last_applied_fingerprint=None):
        self.model_result = model_result
        self.plan = plan
        self.last_applied_fingerprint = last_applied_fingerprint

    @property
    def ok(self):
        return bool(getattr(self.model_result, "ok", False))

    @property
    def operations(self):
        return () if self.plan is None else self.plan.operations

    @property
    def has_changes(self):
        return bool(self.plan is not None and self.plan.has_changes)

    @property
    def fingerprint(self):
        return None if self.plan is None else self.plan.fingerprint

    def render_sql(self):
        return "" if self.plan is None else self.plan.render_sql()

    def pretty(self):
        lines = [self.model_result.pretty()]
        if not self.ok:
            return "\n".join(lines)
        if not self.has_changes:
            lines.extend(("Изменения схемы: нет", "Схема базы данных актуальна"))
            return "\n".join(lines)

        lines.append("Изменения схемы:")
        for operation in self.operations:
            lines.append(f"- [{operation.risk.value}] {operation.summary}")
        return "\n".join(lines)


class SchemaCheckResult(SchemaPlanResult):
    @property
    def database_up_to_date(self):
        return self.ok and not self.has_changes


class SchemaApplyResult(SchemaPlanResult):
    def __init__(self, model_result, plan, last_applied_fingerprint=None, applied=False):
        super().__init__(model_result, plan, last_applied_fingerprint)
        self.applied = applied

    def pretty(self):
        result = "успешно" if self.applied else "пропущено"
        return f"{super().pretty()}\nРезультат применения: {result}"


class Schema:
    def __init__(self, orm):
        self.orm = orm
        self.history = MigrationHistoryStore()

    async def snapshot(self):
        builder = DeclaredSchemaStateBuilder(self.orm.models)
        return builder.build()

    async def _build_plan(self, *, rename_map=None):
        model_result = self.orm.models.compile()
        if not model_result.ok:
            return model_result, None, None
        declared = model_result.declared_schema or await self.snapshot()
        async with self.orm.session() as session:
            actual = await introspect_database_metadata(session)
            latest = await self.history.latest(session)
        fingerprint = self.history.fingerprint_payload(declared.to_dict())
        plan = build_schema_plan(
            declared,
            actual,
            fingerprint=fingerprint,
            rename_map=rename_map,
        )
        return model_result, plan, latest

    async def plan(self, *, rename_map=None):
        model_result, plan, latest = await self._build_plan(rename_map=rename_map)
        return SchemaPlanResult(
            model_result=model_result,
            plan=plan,
            last_applied_fingerprint=None if latest is None else latest.fingerprint,
        )

    async def verify(self, *, rename_map=None):
        result = await self.plan(rename_map=rename_map)
        return SchemaCheckResult(
            model_result=result.model_result,
            plan=result.plan,
            last_applied_fingerprint=result.last_applied_fingerprint,
        )

    async def apply(self, *, allow_destructive=False, plan_only=False, rename_map=None):
        result = await self.plan(rename_map=rename_map)
        if not result.ok:
            raise ORMConfigurationError(result.model_result.pretty())
        if plan_only:
            return result
        ensure_destructive_allowed(result.plan, allow_destructive=allow_destructive)
        if not result.operations:
            return SchemaApplyResult(
                model_result=result.model_result,
                plan=result.plan,
                last_applied_fingerprint=result.last_applied_fingerprint,
                applied=False,
            )
        if all(operation.transactional for operation in result.operations):
            async with self.orm.transaction() as tx:
                await self._execute_operations(tx, result.operations)
                await self.history.record(
                    tx, fingerprint=result.fingerprint, plan_sql=result.render_sql()
                )
        else:
            await self._apply_mixed_plan(result)
        return SchemaApplyResult(
            model_result=result.model_result,
            plan=result.plan,
            last_applied_fingerprint=result.last_applied_fingerprint,
            applied=True,
        )

    async def export_plan(self, path, *, rename_map=None):
        result = await self.plan(rename_map=rename_map)
        payload = {
            "fingerprint": result.fingerprint,
            "last_applied_fingerprint": result.last_applied_fingerprint,
            "operations": [
                {
                    "kind": operation.kind,
                    "summary": operation.summary,
                    "destructive": operation.destructive,
                    "risk": operation.risk.value,
                    "transactional": operation.transactional,
                    "sql": list(operation.sql),
                }
                for operation in result.operations
            ],
        }
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=True)
        return path

    @staticmethod
    async def _execute_operations(session, operations):
        for operation in operations:
            for statement in operation.sql:
                await session.execute(statement)

    async def _apply_mixed_plan(self, result):
        for operation in result.operations:
            if operation.transactional:
                async with self.orm.transaction() as tx:
                    await self._execute_operations(tx, (operation,))
            else:
                async with self.orm.session() as session:
                    await self._execute_operations(session, (operation,))
        async with self.orm.transaction() as tx:
            await self.history.record(
                tx, fingerprint=result.fingerprint, plan_sql=result.render_sql()
            )

    async def startup_check(self):
        mode = str(self.orm.config.schema_mode or "off").strip().lower()
        if mode == "off":
            return None
        if mode == "verify":
            result = await self.verify()
            if not result.database_up_to_date:
                raise ORMConfigurationError(
                    f"Проверка схемы при запуске не пройдена. Ожидающие операции: {', '.join(op.summary for op in result.operations)}"
                )
            return result
        raise ORMConfigurationError(
            f"Режим schema_mode={mode!r} нельзя выполнять при старте приложения. "
            "Используйте schema command или schema_mode='verify'."
        )
