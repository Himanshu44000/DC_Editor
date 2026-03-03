from typing import List, Dict
from models.item import Item, ItemCreate

_items: List[Item] = []
_notes: Dict[int, str] = {}
_next_id = 1

def list_items() -> List[Item]:
    return _items

def create_item(payload: ItemCreate) -> Item:
    global _next_id
    item = Item(id=_next_id, **payload.model_dump())
    _next_id += 1
    _items.append(item)
    return item

def toggle_item(item_id: int) -> Item | None:
    for item in _items:
        if item.id == item_id:
            item.done = not item.done
            return item
    return None

def delete_item(item_id: int) -> bool:
    idx = next((i for i, item in enumerate(_items) if item.id == item_id), -1)
    if idx == -1:
        return False
    _items.pop(idx)
    _notes.pop(item_id, None)
    return True

def set_note(item_id: int, note: str) -> None:
    _notes[item_id] = note

def get_note(item_id: int) -> str:
    return _notes.get(item_id, "")