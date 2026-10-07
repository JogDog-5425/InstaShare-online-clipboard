import json
import asyncio
import traceback
from asyncio import Queue
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from starlette.websockets import WebSocket, WebSocketState

from app.connection import ConnectionManager
from app.data import SpaceData, OperationHint

app = FastAPI()

# Resolve path related problems
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR.parent / "static"
# Make sure static files can be referenced correctly
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

print("STATIC_DIR =", STATIC_DIR)
print("index exists =", (STATIC_DIR / "index.html").exists())

# Runtime space data todo move into Sqlite
spaces = dict()

# [Obsolete] SSE Event queues
# We use space_id->list(subscriber) structure to ensure subscribers are informed respectively
# Queue is how we keep track of the subscribers
event_queues: dict[str, list[Queue]] = dict()

# WebSocket Connection manager
connections = ConnectionManager()


# ===== HTTP Requests =====
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/spaces/verify/{space_id}")
def verify_space(space_id: str) -> bool:
    return space_id in spaces.keys()


def create_space(space_id: str) -> OperationHint:
    if space_id in spaces.keys(): return OperationHint(success=False, message="Space already exists")
    spaces[space_id] = SpaceData(space_id = space_id, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    print(f"Space {space_id} is initialized. ")
    return OperationHint(success=True, message="Space created successfully")


async def edit_space(space_id: str, content: str) -> SpaceData:
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    old_data = spaces[space_id]
    try:
        spaces[space_id] = SpaceData(
            space_id = space_id, content= content, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            version=old_data.version
        )
        spaces[space_id].version += 1

        return spaces[space_id]
    except Exception as e:
        return SpaceData()
        # return OperationHint(success=False, message=f"Error while updating space {e}")


@app.get("/api/spaces/{space_id}")
def get_space(space_id: str) -> SpaceData:
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    return spaces[space_id]


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

    try:
        heartbeat_task = asyncio.create_task(send_heartbeat())

        while connection_active:
            try:
                # ===== Real logic begins =====
                message = await asyncio.wait_for(websocket.receive(), timeout=30)

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
                        await connections.send_json(data["space_id"], {
                            "type": "update",
                            "space_id": data["space_id"],
                            "data": get_space(data["space_id"]).model_dump()
                        })
                    elif data["type"] == "edit":
                        print("Received edit request")

                        await edit_space(data["space_id"], data["data"])

                        await connections.send_json(data["space_id"], {
                            "type": "update",
                            "space_id": data["space_id"],
                            "data": get_space(data["space_id"]).model_dump()
                        })
                        print("Informing other clients of this update")

            except Exception as e:
                print(datetime.now().strftime("%H:%M:%S"))
                traceback.print_exc()

    except Exception as ex:
        print(ex)



if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)
