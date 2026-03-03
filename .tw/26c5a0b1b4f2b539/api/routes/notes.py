from fastapi import APIRouter
from pydantic import BaseModel, Field
from services import store

router = APIRouter(prefix="/notes", tags=["notes"])

class NotePayload(BaseModel):
    note: str = Field(default="", max_length=1000)

@router.get("/{item_id}")
def get_note(item_id: int):
    return {"item_id": item_id, "note": store.get_note(item_id)}

@router.put("/{item_id}")
def put_note(item_id: int, payload: NotePayload):
    store.set_note(item_id, payload.note)
    return {"ok": True, "item_id": item_id, "note": payload.note}