from fastapi import APIRouter

from schemas.ping import PingResponse

router = APIRouter(tags=['health'])


@router.get('/health', response_model=PingResponse)
def health_check() -> PingResponse:
    return PingResponse(status='ok', message='pong')
