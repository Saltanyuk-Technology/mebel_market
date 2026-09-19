import argparse
import asyncio
import json
import sys

from airqore_orm import ORM, ORMConfig

from .database import editor_orm
from .migrations.legacy import migrate_legacy, verify_legacy
from .schema import ensure_schema


def _parser():
    parser = argparse.ArgumentParser(description="Перенос данных редактора в отдельную БД")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="только подсчитать записи")
    mode.add_argument("--verify-only", action="store_true", help="только сверить контрольные суммы")
    parser.add_argument("--source-project-id", help="перенести один мебельный проект и его связи")
    parser.add_argument("--source-fingerprint", default="legacy-mebel-market")
    return parser


async def _run(options):
    source = ORM(config=ORMConfig.from_env())
    await source.startup()
    await editor_orm.startup()
    try:
        await ensure_schema(editor_orm)
        if options.verify_only:
            result = await verify_legacy(
                source, editor_orm, source_project_id=options.source_project_id
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0 if result["valid"] else 2
        report = await migrate_legacy(
            source,
            editor_orm,
            source_fingerprint=options.source_fingerprint,
            dry_run=options.dry_run,
            source_project_id=options.source_project_id,
        )
        print(json.dumps(report.as_dict(), ensure_ascii=False))
        return 0
    finally:
        await source.shutdown()
        await editor_orm.shutdown()


def main():
    return asyncio.run(_run(_parser().parse_args()))


if __name__ == "__main__":
    sys.exit(main())
