import asyncio
import traceback

from starlette.websockets import WebSocket


class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, set[WebSocket]] = dict()
        self.client_space_map: dict[WebSocket, str] = dict()  # Use to locate space faster
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, space_id: str) -> None:
        if websocket in self.client_space_map.keys():
            await self._try_remove(websocket)
        await self._try_add(websocket, space_id)

    async def disconnect(self, websocket: WebSocket) -> None:
        await self._try_remove(websocket)

    async def _try_remove(self, websocket: WebSocket) -> None:
        async with self.lock:
            old_space_id = self.client_space_map.pop(websocket, None)
            if old_space_id is None:
                return

            clients = self.connections.get(old_space_id)
            if clients is None:
                return

            clients.discard(websocket)
            if not clients:
                del self.connections[old_space_id]


    async def _try_add(self, websocket: WebSocket, space_id: str) -> None:
        async with self.lock:
            if not websocket in self.client_space_map:
                if not space_id in self.connections.keys():
                    self.connections[space_id] = set()
                self.connections.setdefault(space_id, set()).add(websocket)
                self.client_space_map[websocket] = space_id

    async def send_json(self, space_id: str, message: dict):
        async with self.lock:
            # Iteration will fail when the collection is modified.
            clients = list(self.connections.get(space_id, []))

            for client in clients:
                try:
                    await client.send_json(message)
                except Exception:
                    traceback.print_exc()
