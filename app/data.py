from pydantic import BaseModel


class SpaceData(BaseModel):
    space_id: str = ""
    content: str = ""
    last_updated: str = ""
    version: int = 1  # For version control


class OperationHint(BaseModel):
    success: bool
    message: str