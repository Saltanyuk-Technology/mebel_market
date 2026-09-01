from .api import Schema, SchemaApplyResult, SchemaCheckResult, SchemaPlanResult
from .diff import (
    MigrationRisk,
    SchemaOperation,
    SchemaPlan,
    build_schema_plan,
    ensure_destructive_allowed,
)
from .history import MigrationHistoryStore
from .inspect import (
    CheckConstraintInfo,
    ColumnMetadata,
    DatabaseMetadata,
    ForeignKeyInfo,
    IndexMetadata,
    TableMetadata,
    UniqueConstraintInfo,
    introspect_database_metadata,
)

__all__ = [
    "MigrationRisk",
    "MigrationHistoryStore",
    "CheckConstraintInfo",
    "ColumnMetadata",
    "DatabaseMetadata",
    "ForeignKeyInfo",
    "IndexMetadata",
    "TableMetadata",
    "UniqueConstraintInfo",
    "SchemaApplyResult",
    "SchemaCheckResult",
    "Schema",
    "SchemaOperation",
    "SchemaPlan",
    "SchemaPlanResult",
    "build_schema_plan",
    "ensure_destructive_allowed",
    "introspect_database_metadata",
]
