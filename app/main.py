import json
import asyncio
from asyncio import Queue
from datetime import datetime

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

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

# SSE Event queues
# We use spaceId->list(subscriber) structure to ensure subscribers are informed respectively
# Queue is how we keep track of the subscribers
event_queues: dict[str, list[Queue]] = dict()

class UpdateRequest(BaseModel):
    content: str


@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/spaces/verify/{space_id}")
def verify_space(space_id: str) -> bool:
    return space_id in spaces.keys()


@app.post("/api/spaces/create/{space_id}")
def create_space(space_id: str) -> OperationHint:
    if space_id in spaces.keys(): return OperationHint(success=False, message="Space already exists")
    spaces[space_id] = SpaceData(space_id = space_id, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    event_queues[space_id] = []  # No subscribers yet; each SSE connection registers its own queue
    print(f"Space {space_id} is initialized. ")
    return OperationHint(success=True, message="Space created successfully")


@app.post("/api/spaces/edit/{space_id}")
async def edit_space(space_id: str, content: UpdateRequest) -> SpaceData:
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    old_data = spaces[space_id]
    try:
        spaces[space_id] = SpaceData(
            space_id = space_id, content= content.content, last_updated=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            version=old_data.version
        )
        spaces[space_id].version += 1
        # Publish: deliver a copy to every subscriber queue of this space
        for subscriber_queue in event_queues.get(space_id, []):
            subscriber_queue.put_nowait(spaces[space_id].content)
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


@app.get("/api/spaces/{space_id}/events")
async def sse_events(space_id: str):
    if space_id not in spaces:
        raise HTTPException(status_code=404, detail=f"Space {space_id} not found")
    # Subscribe: this connection gets its own queue and registers it to the space
    subscriber_queue = asyncio.Queue()
    event_queues.setdefault(space_id, []).append(subscriber_queue)

    # Send events only when this queue receives a message
    async def event_stream():
        try:
            while True:
                await subscriber_queue.get()
                print(f"Should flush: {space_id}")
                # An SSE event needs a data field; an event-only record is
                # ignored by the browser's EventSource parser.
                yield "event: contentModified\ndata: updated\n\n"  # Hint: ‘data’ is mandatory for SSE parsing
        finally:
            # Unsubscribe on disconnect to avoid leaking queues
            try:
                event_queues[space_id].remove(subscriber_queue)
            except (KeyError, ValueError):
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == '__main__':
    uvicorn.run(app, host="0.0.0.0", port=8000)
