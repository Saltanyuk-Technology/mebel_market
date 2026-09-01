def camel_to_snake(name):
    chunks = []
    for index, char in enumerate(str(name)):
        if char.isupper() and index > 0 and not str(name)[index - 1].isupper():
            chunks.append("_")
        chunks.append(char.lower())
    return "".join(chunks)


def pluralize(name):
    value = str(name).strip().lower()
    if value.endswith("y") and len(value) > 1 and value[-2] not in "aeiou":
        return value[:-1] + "ies"
    if value.endswith("s"):
        return value
    return value + "s"


def normalize_identifier(value):
    return str(value).strip().lower()


def qualified_name(schema, table):
    schema_name = normalize_identifier(schema or "")
    table_name = normalize_identifier(table)
    if schema_name and schema_name != "public":
        return f"{schema_name}.{table_name}"
    return table_name
