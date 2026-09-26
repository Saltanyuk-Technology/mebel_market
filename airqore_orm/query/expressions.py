class Expression:
    def __bool__(self):
        raise TypeError("SQL-выражение нельзя использовать как Python boolean.")

    def __and__(self, other):
        if not isinstance(other, Expression):
            raise TypeError("Логические операции поддерживаются только между SQL-выражениями.")
        return BooleanExpression("AND", (self, other))

    def __or__(self, other):
        if not isinstance(other, Expression):
            raise TypeError("Логические операции поддерживаются только между SQL-выражениями.")
        return BooleanExpression("OR", (self, other))


class Value(Expression):
    def __init__(self, value):
        self.value = value


class Column(Expression):
    def __init__(self, model, name, column):
        self.model = model
        self.name = name
        self.column = column

    # Сравнение полей создаёт SQL-условие, а не Python boolean.
    def __eq__(self, value):
        return BinaryExpression(self, "=", as_expression(value))

    def __ne__(self, value):
        return BinaryExpression(self, "!=", as_expression(value))

    def __lt__(self, value):
        return BinaryExpression(self, "<", as_expression(value))

    def __le__(self, value):
        return BinaryExpression(self, "<=", as_expression(value))

    def __gt__(self, value):
        return BinaryExpression(self, ">", as_expression(value))

    def __ge__(self, value):
        return BinaryExpression(self, ">=", as_expression(value))

    def like(self, value):
        return BinaryExpression(self, "LIKE", as_expression(value))

    def ilike(self, value):
        return BinaryExpression(self, "ILIKE", as_expression(value))

    def in_(self, values):
        return InExpression(self, tuple(values))

    def not_in(self, values):
        return InExpression(self, tuple(values), negated=True)

    def between(self, lower, upper):
        return BetweenExpression(self, Value(lower), Value(upper))

    def asc(self, nulls=None):
        return Ordering(self, "ASC", normalize_nulls(nulls))

    def desc(self, nulls=None):
        return Ordering(self, "DESC", normalize_nulls(nulls))


class BinaryExpression(Expression):
    def __init__(self, left, operator, right):
        self.left = left
        self.operator = operator
        self.right = right


class BooleanExpression(Expression):
    def __init__(self, operator, expressions):
        self.operator = operator
        self.expressions = tuple(expressions)


class InExpression(Expression):
    def __init__(self, column, values, negated=False):
        self.column = column
        self.values = tuple(values)
        self.negated = negated


class BetweenExpression(Expression):
    def __init__(self, column, lower, upper):
        self.column = column
        self.lower = lower
        self.upper = upper


class Ordering:
    def __init__(self, column, direction="ASC", nulls=None):
        self.column = column
        self.direction = direction
        self.nulls = nulls


class RawSQL(Expression):
    def __init__(self, sql, params=()):
        self.sql = sql
        self.params = tuple(params)


class Selection:
    def __init__(self, source, field, label=None):
        self.source = source
        self.field = field
        self.label = label


class Join:
    def __init__(
        self,
        table,
        alias,
        source_alias,
        source_columns,
        target_columns,
        kind="JOIN",
    ):
        self.table = table
        self.alias = alias
        self.source_alias = source_alias
        self.source_columns = tuple(source_columns)
        self.target_columns = tuple(target_columns)
        self.kind = kind


def as_expression(value):
    if isinstance(value, Expression):
        return value
    return Value(value)


def normalize_nulls(value):
    if value is None:
        return None
    value = str(value).upper()
    if value not in {"FIRST", "LAST"}:
        raise ValueError("nulls должен быть FIRST или LAST.")
    return value
