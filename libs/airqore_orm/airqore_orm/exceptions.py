class ORMError(Exception):
    # Все ошибки ORM наследуются от этого класса.
    pass


class ORMConfigurationError(ORMError):
    pass


class QueryBuildError(ORMError):
    pass


class ModelDeclarationError(QueryBuildError):
    pass


class FieldValueError(QueryBuildError):
    pass


class RequiredFieldError(QueryBuildError):
    pass


class UnsafeSQLError(QueryBuildError):
    pass


class QueryExecutionError(ORMError):
    def __init__(self, message, sql=None, params=None):
        super().__init__(message)
        self.sql = sql
        self.params = params or ()


class DuplicateKeyError(QueryExecutionError):
    pass


class TransientTransactionError(QueryExecutionError):
    def __init__(self, message, *, sqlstate, sql=None, params=None):
        super().__init__(message, sql=sql, params=params)
        self.sqlstate = sqlstate


class QueryTimeoutError(QueryExecutionError):
    pass


class TransactionError(ORMError):
    pass


class PoolTimeoutError(TransactionError):
    pass
