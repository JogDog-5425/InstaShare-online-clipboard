import json
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse, HTMLResponse
from pathlib import Path

from app.data import SpaceData, OperationHint

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR.parent / "static"

print("STATIC_DIR =", STATIC_DIR)
print("index exists =", (STATIC_DIR / "index.html").exists())

spaces = dict()


class UpdateRequest(BaseModel):
    content: str


@app.get("/", response_class=HTMLResponse)
def index():
    # index_html = open(STATIC_DIR / "index.html", "r").read()
    # return index_html
    return FileResponse("../static/index.html")


@app.get("/api/spaces/verify/{space_id}")
def verify_space(space_id: str) -> bool:
    return space_id in spaces.keys()


@app.post("/api/spaces/create/{space_id}")
def create_space(space_id: str) -> OperationHint:
    if space_id in spaces.keys(): return OperationHint(success=False, message="Space already exists")
    spaces[space_id] = SpaceData(space_id = space_id, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print(f"Space {space_id} is initialized. ")
    return OperationHint(success=True, message="Space created successfully")


@app.post("/api/spaces/edit/{space_id}")
def edit_space(space_id: str, content: UpdateRequest) -> SpaceData:
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    old_data = spaces[space_id]
    try:
        spaces[space_id] = SpaceData(
            space_id = space_id, content= content.content, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            version=old_data.version
        )
        spaces[space_id].version += 1
        # return OperationHint(success=True, message="Space edited successfully")
        return spaces[space_id]
    except Exception as e:
        return SpaceData()
        # return OperationHint(success=False, message=f"Error while updating space {e}")


@app.get("/api/spaces/{space_id}")
def get_space(space_id: str) -> SpaceData:
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    return spaces[space_id]


if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)
