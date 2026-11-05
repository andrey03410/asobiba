import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.auth.routes import router as auth_router
from src.core.exceptions import DomainError
from src.core.logging import request_id_var, setup_logging
from src.core.settings import settings
from src.games.routes import router as games_router
from src.lobbies.routes import router as lobbies_router
from src.lobbies.ws import router as ws_router

setup_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title="Asobiba")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid4().hex[:12]
    token = request_id_var.set(rid)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["x-request-id"] = rid
    return response


@app.exception_handler(DomainError)
async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    logger.warning(
        "domain error on %s %s: %s code=%s status=%s",
        request.method,
        request.url.path,
        exc.message,
        exc.code,
        exc.status_code,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "code": exc.code},
    )

app.include_router(auth_router)
app.include_router(games_router)
app.include_router(lobbies_router)
app.include_router(ws_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
