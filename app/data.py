import sqlite3
from datetime import datetime
from email.mime import image

from pydantic import BaseModel


class SpaceData(BaseModel):
    space_id: str = ""
    content: str = ""
    last_updated: str = ""
    version: int = 1  # For version control
    image: str = ""


class OperationHint(BaseModel):
    success: bool
    message: str


# ============ Sqlite access ============
class SpaceDataAccessor:
    def __init__(self, db_path):
        self._path = db_path
        self._init_db()

    def _init_db(self):
        from contextlib import closing
        with closing(self._connect()) as con:
            con.execute("""
                CREATE TABLE IF NOT EXISTS data (
                    space_id     TEXT(50) PRIMARY KEY,
                    content      TEXT,
                    last_updated TEXT(50),
                    version      INTEGER,
                    image        TEXT DEFAULT ''
                )
            """)
            con.commit()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row  # In order to access result just like a dictionary
        return connection

    def exists(self, space_id: str):
        connection = self._connect()
        cursor = connection.execute("SELECT 1 FROM data WHERE space_id = ? LIMIT 1", (space_id,))

        result = not cursor.fetchone() is None
        connection.close()

        return result

    def create(self, space_id: str) -> bool:
        # if self.exists(space_id): return False
        connection = self._connect()
        try:
            connection.execute(
                "INSERT INTO data (space_id, content, last_updated, version) VALUES (?, ?, ?, ?)",
                (space_id, "", datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 1))
            connection.commit()
            connection.close()

            return True
        except sqlite3.IntegrityError:
            connection.close()
            return False

    def get_space(self, space_id: str) -> SpaceData | None:
        # if not self.exists(space_id): return None
        connection = self._connect()

        cursor = connection.execute("SELECT * FROM data WHERE space_id = ?", (space_id,))
        row = cursor.fetchone()

        if not row:
            connection.close()
            return None

        connection.close()
        return self.row_to_space_data(row)

    def edit(self, space_id: str, content: str) -> SpaceData | None:
        # Since space currently will not be cleared, checking existence in a separate step is safe
        if not self.exists(space_id): return None

        connection = self._connect()

        last_updated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Update the version directly in the database, not in python
        connection.execute(
            "UPDATE data SET content = ?, last_updated = ?, version = version + 1 WHERE space_id = ?",
            (content, last_updated, space_id))
        connection.commit()

        # Version is currently not needed but still reserved for todo future version conflict resolution
        cursor = connection.execute("SELECT version FROM data WHERE space_id = ?", (space_id,))
        version = cursor.fetchone()["version"]

        connection.close()

        return SpaceData(
            space_id=space_id,
            content=content,
            last_updated=last_updated,
            version=version
        )

    def set_image(self, space_id: str, filepath: str) -> bool:
        if not self.exists(space_id) or not filepath: return False

        connection = self._connect()

        last_updated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        connection.execute(
            "UPDATE data SET image = ?, last_updated = ? WHERE space_id = ?",
            (filepath, last_updated, space_id))
        connection.commit()

        connection.close()

        return True

    @staticmethod
    def row_to_space_data(row: sqlite3.Row) -> SpaceData:
        return SpaceData(
            space_id=row["space_id"],
            content=row["content"] or "",
            last_updated=row["last_updated"] or "",
            version=row["version"] or 1,
            image=row["image"] or ""
        )
