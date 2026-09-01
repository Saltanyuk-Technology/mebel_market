import os

from hypercorn.config import Config


HOST = os.getenv("USER_SERVICE_HOST", os.getenv("AUTH_HOST", "127.0.0.1"))
PORT = int(os.getenv("USER_SERVICE_PORT", os.getenv("AUTH_PORT", "8080")))
SECRET_KEY = os.getenv("USER_SERVICE_SECRET_KEY", os.getenv("AUTH_SECRET_KEY", "local-development-only-change-me"))
COOKIE_SECURE = os.getenv("USER_SERVICE_COOKIE_SECURE", os.getenv("AUTH_COOKIE_SECURE", "false")).lower() == "true"
SESSION_MAX_AGE = 14 * 24 * 60 * 60


def configure_app(app) -> None:
    app.secret_key = SECRET_KEY
    app.config.update(
        TEMPLATES_AUTO_RELOAD=True,
        SEND_FILE_MAX_AGE_DEFAULT=0,
    )
    app.jinja_env.auto_reload = True
    app.jinja_env.cache = None


def hypercorn_config() -> Config:
    config = Config()
    config.bind = [f"{HOST}:{PORT}"]
    config.use_reloader = False
    return config
