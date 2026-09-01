"""Запускает все локальные сервисы Mebel Market."""

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def ensure_port_is_free(host: str, port: int, service_name: str) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((host, port)) == 0:
            raise RuntimeError(
                f"Не удалось запустить {service_name}: порт {port} уже занят. "
                "Остановите прежний процесс или перезагрузите Windows."
            )


@dataclass(frozen=True)
class Service:
    name: str
    cwd: Path
    command: tuple[str, ...]
    url: str


def definitions() -> tuple[Service, ...]:
    package_manager = shutil.which("pnpm") or shutil.which("npm")
    if not package_manager:
        raise RuntimeError(
            "Не найдены 'pnpm' и 'npm'. Установите Node.js, заново откройте консоль "
            "и выполните установку frontend-зависимостей из README.md."
        )
    run_script = (package_manager, "dev") if Path(package_manager).stem == "pnpm" else (
        package_manager,
        "run",
        "dev",
    )
    return (
        Service(
            "user",
            ROOT / "services/user-service",
            (sys.executable, "server.py"),
            "http://127.0.0.1:8080/health",
        ),
        Service("constructor", ROOT / "services/constructor-service", run_script, "http://127.0.0.1:5173/constructor/"),
        Service("editor", ROOT / "services/editor-service", run_script, "http://127.0.0.1:5174/editor/"),
    )


def child_environment() -> dict[str, str]:
    environment = os.environ.copy()
    values = (str(ROOT / "libs/airqore_orm"), environment.get("PYTHONPATH"))
    environment["PYTHONPATH"] = os.pathsep.join(value for value in values if value)
    environment["PYTHONUNBUFFERED"] = "1"
    return environment


def start_service(service: Service) -> subprocess.Popen:
    return subprocess.Popen(
        service.command,
        cwd=service.cwd,
        env=child_environment(),
        creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0),
    )


def watched_state(service: Service) -> dict[Path, int]:
    if service.name != "user":
        return {}
    extensions = {".py", ".html", ".css", ".js"}
    return {
        path: path.stat().st_mtime_ns
        for path in service.cwd.rglob("*")
        if path.is_file() and path.suffix.lower() in extensions and "__pycache__" not in path.parts
    }


def stop_all(processes: list[subprocess.Popen]) -> None:
    if os.name == "nt":
        for process in reversed(processes):
            if process.poll() is None:
                subprocess.run(
                    ("taskkill", "/PID", str(process.pid), "/T", "/F"),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
        return
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    for process in reversed(processes):
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def main() -> int:
    processes: list[subprocess.Popen] = []
    stopping = False

    def request_stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    try:
        print("Запуск сервисов Mebel Market...", flush=True)
        ensure_port_is_free("127.0.0.1", 8080, "пользовательский сервис")
        ensure_port_is_free("127.0.0.1", 5173, "конструктор")
        ensure_port_is_free("127.0.0.1", 5174, "редактор")
        running: list[list] = []
        for service in definitions():
            process = start_service(service)
            processes.append(process)
            running.append([service, process, watched_state(service)])
            print(f"  {service.name:<12} {service.url}", flush=True)
        print("Все сервисы запущены. Для остановки нажмите Ctrl+C.", flush=True)

        while not stopping:
            for item in running:
                service, process, previous_state = item
                current_state = watched_state(service)
                if previous_state and current_state != previous_state:
                    print("Изменения в auth обнаружены — перезапуск...", flush=True)
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                    process = start_service(service)
                    processes.append(process)
                    item[1] = process
                    item[2] = current_state
                    continue
                code = process.poll()
                if code is not None:
                    failure_code = code or 1
                    print(
                        f"Сервис {service.name} неожиданно завершился "
                        f"(код процесса: {code}, ошибка запуска: {failure_code}).",
                        file=sys.stderr,
                    )
                    return failure_code
            time.sleep(0.5)
        return 0
    except (OSError, RuntimeError) as error:
        print(f"Не удалось запустить проект: {error}", file=sys.stderr)
        return 1
    finally:
        if processes:
            print("Остановка сервисов...", flush=True)
            stop_all(processes)


if __name__ == "__main__":
    raise SystemExit(main())
