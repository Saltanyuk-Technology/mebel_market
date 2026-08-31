from pathlib import Path

from quart import Quart, jsonify, redirect, send_from_directory

from database import orm
from airqore_orm import install_orm


app = Quart(__name__)
install_orm(app, orm=orm)

CONSTRUCTOR_DIST = Path(__file__).parent / "modules" / "constructor" / "dist"
EDITOR_DIST = Path(__file__).parent / "modules" / "editor" / "dist"


@app.get("/")
async def index():
    return jsonify(project="mebel", status="ok")


@app.get("/constructor")
async def constructor_redirect():
    return redirect("/constructor/")


@app.get("/constructor/")
async def constructor_index():
    return await send_from_directory(CONSTRUCTOR_DIST, "index.html")


@app.get("/constructor/<path:filename>")
async def constructor_static(filename: str):
    return await send_from_directory(CONSTRUCTOR_DIST, filename)


@app.get("/editor")
async def editor_redirect():
    return redirect("/editor/")


@app.get("/editor/")
async def editor_index():
    return await send_from_directory(EDITOR_DIST, "index.html")


@app.get("/editor/<path:filename>")
async def editor_static(filename: str):
    return await send_from_directory(EDITOR_DIST, filename)


if __name__ == "__main__":
    app.run()
