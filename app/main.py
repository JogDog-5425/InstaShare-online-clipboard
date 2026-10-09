import json
import asyncio
import traceback
import uuid
from asyncio import Queue
from datetime import datetime

import uvicorn
from fastapi import FastAPI, UploadFile, File
from starlette.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from starlette.websockets import WebSocket, WebSocketState

from app.connection import ConnectionManager
from app.data import SpaceData, OperationHint, SpaceDataAccessor

app = FastAPI()

# Resolve path related issues
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR.parent / "static"
UPLOAD_PATH = BASE_DIR.parent / "upload"
UPLOAD_PATH.mkdir(parents=True, exist_ok=True)
DB_PATH = BASE_DIR.parent / "data" / "clipboard_data.db"
# Make sure static files can be referenced correctly
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/upload", StaticFiles(directory=UPLOAD_PATH), name="upload")

print("STATIC_DIR =", STATIC_DIR)
print("index exists =", (STATIC_DIR / "index.html").exists())

# Space data
# spaces = dict()
clipboard_db = SpaceDataAccessor(DB_PATH)

# [Obsolete] SSE Event queues
# We use space_id->list(subscriber) structure to ensure subscribers are informed respectively
# Queue is how we keep track of the subscribers
event_queues: dict[str, list[Queue]] = dict()

# WebSocket Connection manager
connections = ConnectionManager()


# Image upload settings
ALLOWED = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_SIZE = 5 * 1024 * 1024


# ============ Text editing ============
# ===== HTTP Requests =====
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/api/spaces/verify/{space_id}")
def verify_space_endpoint(space_id: str) -> bool:
    return verify_space(space_id)


# [Obsolete] This function has been integrated into SpaceDataAccessor
def verify_space(space_id: str) -> bool:
    # return space_id in spaces.keys()
    return clipboard_db.exists(space_id)


def create_space(space_id: str) -> OperationHint:
    if clipboard_db.create(space_id):
        return OperationHint(success=True, message="Space created successfully")
    else:
        return OperationHint(success=False, message="Space already exists")


def edit_space(space_id: str, content: str) -> SpaceData | None:
    return clipboard_db.edit(space_id, content)


def get_space(space_id: str) -> SpaceData | None:
    # if space_id not in spaces:
    #     raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    # return spaces[space_id]
    return clipboard_db.get_space(space_id)


# ===== WebSocket Solution =====
@app.websocket("/api/spaces/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # To keep the connection alive
    connection_active = True
    heartbeat_task = None

    async def send_heartbeat():
        """Send periodic heartbeats to keep connection alive."""
        while connection_active:
            try:
                await asyncio.sleep(15)
                if websocket.client_state == WebSocketState.CONNECTED:
                    # Send a ping command
                    await websocket.send_json({"type": "ping"})
            except Exception as exception:
                traceback.print_exc()
                break

    try:
        heartbeat_task = asyncio.create_task(send_heartbeat())

        while connection_active:
            try:
                # ===== Real logic begins =====
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=30)
                except asyncio.TimeoutError:
                    continue

                if message.get("type") == "websocket.disconnect":
                    print("Client disconnected gracefully")
                    connection_active = False
                    break

                elif message.get("type") == "websocket.receive":
                    # Parse the JSON
                    data = json.loads(str(message.get("text")))
                    if data["type"] == "create":
                        print("Received create request")
                        create_space(data["space_id"]).model_dump()

                        await connections.connect(websocket, data["space_id"])
                        # await websocket.send_json({"type": "response", "": "", "data":create_space(data["space_id"]).model_dump()})
                    elif data["type"] == "enter":
                        await connections.connect(websocket, data["space_id"])
                    elif data["type"] == "sync":
                        print("Received sync request")
                        space_data = clipboard_db.get_space(data["space_id"])
                        if space_data is not None:
                            await connections.send_json(data["space_id"], {
                                "type": "update",
                                "space_id": data["space_id"],
                                "data": space_data.model_dump()
                            })
                        else:
                            print("We cannot obtain the space data, therefore synchonization fails")
                    elif data["type"] == "edit":
                        print("Received edit request")

                        space_data = edit_space(data["space_id"], data["data"])

                        if space_data is not None:
                            await connections.send_json(data["space_id"], {
                                "type": "update",
                                "space_id": data["space_id"],
                                "data": space_data.model_dump()
                            })
                            print("Informing other clients of this update")
                        else:
                            print("We cannot obtain the space data, therefore edit fails")

            except Exception as e:
                print(datetime.now().strftime("%H:%M:%S"))
                traceback.print_exc()

    except Exception as ex:
        print(ex)
    finally:
        connection_active = False
        if heartbeat_task:
            heartbeat_task.cancel()
        await connections.disconnect(websocket)


# ============ Image uploading ============
@app.post("/api/spaces/{space_id}/image")
async def upload_image(space_id: str, file: UploadFile = File(...)) -> dict:
    if file.content_type not in ALLOWED:
        return {"status": False, "message": "type_not_supported"}

    data = await file.read()
    if len(data) > MAX_SIZE:
        return {"status": False, "message": "exceeding-size-limit"}

    # Save image data into file
    ext = file.filename.split(".")[-1] if file.filename else "png"  # Fallback file type: PNG
    filename = f"{uuid.uuid4().hex}.{ext}"
    path = UPLOAD_PATH / filename
    with open(path, "wb") as file:
        file.write(data)

    # Return the url, and also add it into database
    url = f"/upload/{filename}"
    if clipboard_db.set_image(space_id, url):
        # Broadcast the update
        space_data = clipboard_db.get_space(space_id)
        await connections.send_json(space_id, {
            "type": "update", "space_id": space_id, "data": space_data.model_dump()})

    print(f"Uploaded an image, which can be accessed via {url}")

    return {"status": True, "url": url}

if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)
