import asyncio

from quart import Quart

from airqore_orm.integrations.quart import install_orm
from configuration.server_config import orm
from configuration.server_config import SECRET_KEY, HOST, PORT
from modules.admin_profile.controller import controller as admin_profile_controller
from modules.auth_old.controller import controller as auth_controller
from modules.company_profile.controller import controller as company_profile_controller
from modules.platform.controller import controller as platform_controller
from modules.user_profile.controller import controller as user_profile_controller
from modules.kitchen_projects.controller import controller as kitchen_projects_controller


#TODO: Необходимо проверить работу before_serving и after_serving


def blueprint_registration(app):
    for controller in (
        platform_controller, auth_controller, user_profile_controller,
        company_profile_controller, admin_profile_controller, kitchen_projects_controller):

        app.register_blueprint(controller)


def configure_app(app):
    app.secret_key = SECRET_KEY
    app.config.update(TEMPLATES_AUTO_RELOAD=True, SEND_FILE_MAX_AGE_DEFAULT=0)
    app.jinja_env.auto_reload = True
    app.jinja_env.cache = None


app = Quart(__name__)
# конфигурация основного приложения
configure_app(app)
# Инициализация подключений к БД
install_orm(app, orm=orm)
# Регистрация маршрутов
blueprint_registration(app)



if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=True, use_reloader=True)
