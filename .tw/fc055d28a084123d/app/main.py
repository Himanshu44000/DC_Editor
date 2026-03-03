from fastapi import FastAPI

from api.routes import health, tasks, stats
from core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.APP_DEBUG,
)

app.include_router(health.router, prefix=settings.API_PREFIX)
app.include_router(tasks.router, prefix=settings.API_PREFIX)
app.include_router(stats.router, prefix=settings.API_PREFIX)


@app.get('/')
def root() -> dict[str, str]:
    return {'message': 'Hello World'}
