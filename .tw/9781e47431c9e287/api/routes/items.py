from fastapi import APIRouter, HTTPException
from models.item import Item, ItemCreate
from services import store

router = APIRouter(prefix="/items", tags=["items"])

@router.get("", response_model=list[Item])
def get_items():
    return store.list_items()

@router.post("", response_model=Item)
def post_item(payload: ItemCreate):
    return store.create_item(payload)

@router.patch("/{item_id}/toggle", response_model=Item)
def patch_item_toggle(item_id: int):
    updated = store.toggle_item(item_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated

@router.delete("/{item_id}")
def remove_item(item_id: int):
    if not store.delete_item(item_id):
        raise HTTPException(status_code=404, detail="Item not found")
    return {"ok": True}