import unittest

from quart import render_template

from server import app


class ProjectTemplateTests(unittest.IsolatedAsyncioTestCase):
    async def test_company_project_card_opens_project_workspace(self):
        async with app.test_request_context("/company"):
            html = await render_template(
                "company.html",
                user={
                    "firstname": "Тест",
                    "secondname": "Компания",
                    "email": "company@example.test",
                },
                projects=[{
                    "id": "project-1",
                    "name": "Тестовый",
                    "roomCount": 0,
                    "furnitureCount": 0,
                }],
                editor_api_unavailable=False,
            )

        self.assertIn(
            '<a class="kitchen-project" href="/company/projects/project-1">',
            html,
        )
        self.assertIn('<span class="primary-project-action">Открыть проект →</span>', html)

    async def test_project_page_renders_rooms_furniture_and_library_actions(self):
        async with app.test_request_context("/company/projects/project-1"):
            html = await render_template(
                "project.html",
                user={
                    "firstname": "Тест",
                    "secondname": "Компания",
                    "email": "company@example.test",
                },
                project={"id": "project-1", "name": "Дом Анны"},
                rooms=[
                    {"id": "room-1", "name": "Кухня", "roomData": {"walls": []}},
                    {"id": "room-2", "name": "Гостиная", "roomData": {"walls": []}},
                ],
                furniture=[{"id": "furniture-1", "name": "Шкаф"}],
                library=[{
                    "id": "library-1",
                    "definitionId": "library-definition-1",
                    "name": "Шкаф из библиотеки",
                }],
            )

        self.assertIn("Помещения <b>2</b>", html)
        self.assertIn("/constructor/?room=room-1", html)
        self.assertIn("/editor/?new=1&amp;projectId=project-1", html)
        self.assertIn('data-copy-library="library-1"', html)
        self.assertIn("Редактировать оригинал", html)


if __name__ == "__main__":
    unittest.main()
