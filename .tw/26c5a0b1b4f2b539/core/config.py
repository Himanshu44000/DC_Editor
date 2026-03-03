from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = 'FastAPI App'
    APP_ENV: str = 'development'
    APP_DEBUG: bool = True
    API_PREFIX: str = '/api'

    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8')


@lru_cache
def get_settings() -> Settings:
    return Settings()
