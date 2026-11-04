from fastapi import APIRouter, Response

from api import identity, schemas

router = APIRouter(tags=["identity"])


@router.get(
    "/.well-known/jwks.json",
    response_model=schemas.JsonWebKeySet,
    summary="The public keys that verify the identity token",
    description=(
        "The keys a data connection or an agent verifies the `X-Workspace-Identity` header with. "
        "The token is signed with ES256; its `iss` is this API's address and its `aud` is the "
        "connection's origin. Anyone may read the keys."
    ),
)
async def get_jwks(response: Response):
    response.headers["Cache-Control"] = "public, max-age=300"
    return await identity.jwks()
