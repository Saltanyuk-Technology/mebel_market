import socket

from configuration import HOST, PORT


def ensure_server_port_is_free() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((HOST, PORT)) == 0:
            raise RuntimeError(
                f"Порт {PORT} уже занят. Остановите предыдущий запуск user-сервиса."
            )
