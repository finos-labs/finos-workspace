import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal, TypeAlias, TypeVar
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

from fastapi.responses import JSONResponse
from pydantic import (
    AliasGenerator,
    AliasPath,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    StringConstraints,
    alias_generators,
    field_validator,
    model_validator,
)
from pydantic.functional_validators import AfterValidator, BeforeValidator

from api import base
from api.events.types import RoleAuditAction, RoleResourceType
from utilities.config import BaseModel, settings

if TYPE_CHECKING:
    from api.models.workspace_models import CopilotChat, StoredFile


StoredFileT = TypeVar("StoredFileT", bound="StoredFile")

main_config = ConfigDict(extra="forbid", from_attributes=True)
# Who signs in at POST /app/login: the web app ("app", and "oauth-app" after a sign-in
# provider) or the Excel add-in
AppLoginSource = Literal["app", "oauth-app", "excel"]
MetaDataWidgetType = Literal[
    "iframe",
    "copilot_table",
    "youtube",
    "widget_studio",
    "chart",
    "html",
    "ag_chart_from_table",
]

permissions_type = Literal["view", "comment"]  # "edit"
UserSourceType = Literal["user", "invite"]
ExtensionType = Literal[
    "csv",
    "json",
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "xls",
    "xlsx",
    "txt",
    "zip",
    "md",
    "docx",
    "doc",
    "html",
]
AccessType = Literal["no-access", "access", "full-access"]
UserType = Literal["Admin", "Developer", "User"]
SharingLevel = Literal["none", "receive", "share"]


def is_bad_word(word: str) -> bool:
    with open("utilities/bad_words.txt", encoding="utf-8") as f:
        for line in f:
            if line.replace("\n", "") == word:
                return True
    return False


def username_check(username: str) -> None | str:
    pattern = r"^\w{4,50}$"
    if not re.match(pattern, username, re.IGNORECASE):
        return (
            "Please make sure your username is letters, numbers, and underscores, and is between 4 and 50 characters long"  # noqa: E501
        )

    if is_bad_word(username.lower()):
        return "This username violates Community Guidelines"
    return None


def check_email(v: str) -> str:
    if not base.check_email(v):
        raise ValueError("Invalid email")
    return v


SharesPermissions = dict[Annotated[str, AfterValidator(check_email)], permissions_type]


VALID_REGEX = r"^(?=\S*[a-z])(?=\S*[A-Z])(?=\S*\d)(?=\S*[^\w\s])\S{8,}$"
SKILL_SLUG_REGEX = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def check_password(v: str) -> str:
    if isinstance(v, bytes):
        v = v.decode("utf-8")

    if isinstance(v, str) and not re.match(VALID_REGEX, v):
        raise ValueError(
            "Password must be at least 8 characters long, contain at least one "
            "uppercase letter, one lowercase letter, one number, and one special character. "
            "Spaces are not allowed."
        )
    return v


def check_email_or_username(v: str) -> str:
    if not base.check_email(v) and username_check(v):
        raise ValueError("Invalid email or username")
    return v


def check_totp_token(v: None | int) -> None | int:
    # The totp can be less than 6 because
    if v and len(str(v)) > 6:  # noqa: PLR2004
        raise ValueError("Invalid TOTP token")
    return v


def check_name(v: None | str) -> None | str:
    if v:
        for char in settings.UNUSABLE_JSON_CHARACTERS:
            if char in v:
                raise ValueError(f"Script name cannot contain {char}")
    return v


def check_system(v: None | str) -> None | str:
    if v:
        for system in v.split(","):
            if system not in base.get_systems():
                raise ValueError(f"Invalid system: {system}")
    return v


def check_version(v: None | str) -> None | str:
    if v and not re.match(r"^\d+\.\d+\.\d+$", v):
        raise ValueError(f"Invalid version: {v}")
    return v


def get_camel_config(**config: ConfigDict) -> ConfigDict:
    return ConfigDict(
        **config,
        populate_by_name=True,
        alias_generator=AliasGenerator(alias=alias_generators.to_camel),
    )


def get_widget_metadata(
    apps_json_cache: list[dict] | None,
    widgets_json_cache: dict[str, dict] | None = None,
) -> dict[Literal["widgets", "totalWidgets"], Any]:
    """Extract app widget metadata and counts from cached manifests."""
    if (
        not apps_json_cache
        or not isinstance(apps_json_cache, list)
        or not widgets_json_cache
        or not isinstance(widgets_json_cache, dict)
    ):
        return {"widgets": [], "totalWidgets": 0}

    widgetCounts = {}
    for app in apps_json_cache:
        for tab in app.get("tabs", {}).values():
            for layout in tab.get("layout", []):
                widgetId = layout.get("i")
                if widgetId:
                    widgetCounts[widgetId] = widgetCounts.get(widgetId, 0) + 1

    widgets = []
    if widgets_json_cache and isinstance(widgets_json_cache, dict):
        for widgetId, widget in widgets_json_cache.items():
            if widgetId in widgetCounts and widget.get("name"):
                widgets.append(
                    AppWidgetMetadata(
                        id=widgetId,
                        name=widget.get("name"),
                        description=widget.get("description"),
                        count=widgetCounts[widgetId],
                    )
                )

    totalWidgets = sum(widgetCounts.values())
    return {"widgets": widgets, "totalWidgets": totalWidgets}


def get_prompts(apps_json_cache: list | None) -> list[str]:
    """Extract prompts from cached apps.json."""
    if not apps_json_cache or not isinstance(apps_json_cache, list):
        return []

    prompts = []
    for app in apps_json_cache:
        if isinstance(app, dict) and "prompts" in app:
            prompts.extend(app["prompts"])
    return prompts


def app_rating_to_average(ratings: list | None) -> float | None:
    """Calculate average rating from a list of ratings."""
    if not ratings:
        return None

    if (total_ratings := len(ratings)) == 0:
        return None

    rating_sum = sum(r.rating for r in ratings)
    average_rating = rating_sum / total_ratings
    return round(average_rating, 2)


# Named replacements for inline lambdas inside Annotated[...] — Cython
# can't serialise lambdas in those forward refs, so Pydantic later trips
# on `<lambda>`. See marketplace_schemas._is_development_status for the
# original example of this workaround.
def _prompts_count(v: list | None) -> int:
    return len(get_prompts(v))


def _none_to_empty_str(v: str | None) -> str:
    return v or ""


def _is_development_status(v) -> bool:
    return v == base.AppStatus.development


def _is_not_none(v) -> bool:
    return v is not None


VenderAppPrompts = Annotated[list[str], BeforeValidator(get_prompts)]
PromptsCount = Annotated[int, BeforeValidator(_prompts_count)]
AppRating: TypeAlias = Annotated[float | None, BeforeValidator(app_rating_to_average)]
NoneToStr: TypeAlias = Annotated[str | None, BeforeValidator(_none_to_empty_str)]


class SuccessReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    success: bool

    @classmethod
    def success_instance(cls):
        return cls(success=True)

    @classmethod
    def failure_instance(cls):
        return cls(success=False)

    @classmethod
    def from_bool(cls, value: bool):
        return cls(success=value)


class PasswordResetLink(SuccessReturn):
    """The link an administrator gives a new user, or one whose password they reset, with
    which the user sets their password. It works once, until expires_at."""

    link: str
    expires_at: datetime


class PasswordReset(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    """The token of a password reset link, and the user's new password."""

    token: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Annotated[str, AfterValidator(check_password)]


class DashboardShareReturn(BaseModel):
    created_date: None | datetime
    permissions: None | base.PermissionEnum
    first_name: None | str
    last_name: None | str
    # A developer's share that waits for an admin's approval
    pending: bool = False


class ShareReturn(SuccessReturn):
    """What became of a share: a developer's waits for an admin of their organization to
    approve it."""

    pending_approval: bool = False


class ShareRequestUser(BaseModel):
    email: str
    first_name: None | str
    last_name: None | str


class ShareRequestReturn(BaseModel):
    """A share a developer asked for, as the admins of their organization see it."""

    uuid: UUID
    created_date: None | datetime
    requester: ShareRequestUser
    item_type: Literal["dashboard", "app"]
    item_uuid: UUID
    item_name: str
    # None: the whole organization
    recipient: None | ShareRequestUser
    permissions: None | str


class TotpGenerateReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uri: str
    secret: str


class MessageReturn(SuccessReturn, extra="ignore"):  # type: ignore[call-arg]
    message: str


class PendingFileReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    stored_file_uuid: None | UUID = None
    extension: None | str = None
    original_file_name: None | str = None
    url: None | str = None
    failed: bool = False


class PreSignedUrlReturn(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    pre_signed_url: str
    stored_file_uuid: UUID = Field(serialization_alias="stored_file_uuid", alias="uuid")
    original_file_name: str


class AdminSession(BaseModel):
    """Who is signed in to the admin panel (POST /login, GET /session)."""

    model_config = main_config
    email: str
    is_superuser: bool


class AgentToken(BaseModel):
    """A token for the default Copilot to act for the signed-in user (POST
    /app/copilot/token). It is accepted on GET /app/user, PUT /app/usage and POST
    /app/copilot/authorize only, and ends with the session at the latest."""

    model_config = main_config
    token: str
    expires_in: int


class Expiration(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    days: int = Field(ge=1, le=365)


class UUIDReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID


# Provider keys a browser once kept in its display settings. They are stored encrypted in
# their own columns (PUT /app/copilot-keys) and are dropped from display settings on the way
# in and out.
DISPLAY_SETTINGS_SECRETS = ("openaiApiKey", "perplexityApiKey")


class UserDisplaySettings(BaseModel, extra="allow"):  # type: ignore[call-arg]
    theme: Literal["light", "dark"] | None = None
    showWidgetControls: bool = False
    virtualizeWidgets: bool = False
    fontSize: Literal["small", "medium", "large"] = "medium"
    gridCorners: list[Literal["ne", "nw", "se", "sw"]] = ["se"]
    gridSnapping: Literal["off", "vertical"] = "vertical"
    quickAddButtonTransparent: bool = False
    lastVisitedPage: str | None = "/app"

    @model_validator(mode="before")
    @classmethod
    def drop_secrets(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if k not in DISPLAY_SETTINGS_SECRETS}
        return data


class WidgetMetadata(BaseModel):
    model_config = get_camel_config()
    description: None | str = None
    category: None | str = None
    sub_category: None | str = None


class CreateFileWidget(WidgetMetadata, extra="forbid"):  # type: ignore[call-arg]
    model_config = get_camel_config()
    stored_file_uuid: None | UUID = None
    url: HttpUrl
    name: str
    extension: ExtensionType
    data_key: None | str
    original_file_name: None | str
    source: None | str = None


class ReturnFileWidget(CreateFileWidget, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config(from_attributes=True)
    uuid: UUID
    id_: UUID = Field(serialization_alias="id", alias="uuid")
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")


class ApiSourceEndpointHeaders(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config()
    key: str
    value: str
    location: Literal["headers", "query"] = "headers"


class ApiSourceBase(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config()
    name: str
    url: HttpUrl
    endpointHeaders: None | list[ApiSourceEndpointHeaders] = Field(default_factory=list)

    @field_validator("endpointHeaders", mode="before", check_fields=False)
    @classmethod
    def check_endpoint_headers(cls, value: None | dict | list) -> None | list:
        # Handle case where database has {} instead of [] or null
        if isinstance(value, dict):
            return list(value.values()) if value else []
        return value


class CreateApiSource(ApiSourceBase):
    vendor_app_uuid: None | UUID = None


class AppWidgetMetadata(BaseModel):
    id_: str = Field(serialization_alias="id", alias="id")
    name: str
    description: None | str = None
    count: int


class VendorAppSchema(BaseModel):
    model_config = get_camel_config(from_attributes=True)

    uuid: UUID
    name: str
    parent_app_uuid: UUID | None = Field(None, validation_alias="parent_app_uuid")
    vendor_name: str = Field(..., validation_alias=AliasPath("vendor", "name"))
    short_description: str | None = None
    category: str | None = None
    tagline: str | None = None
    apps_json_url: str | None = None
    widgets_json_url: str | None = None
    thumbnail: NoneToStr = Field("", validation_alias="thumbnail_url")
    thumbnail_dark: NoneToStr = Field("", validation_alias="thumbnail_url_dark")
    thumbnail_light: NoneToStr = Field("", validation_alias="thumbnail_url_light")
    version: str | None = None
    widgets: list[AppWidgetMetadata] | None = Field(default_factory=list)
    total_widgets: int | None = Field(0)

    prompts: VenderAppPrompts = Field(default_factory=list, validation_alias="apps_json_cache")
    widgets_json_cache: None | dict = None
    apps_json_cache: None | list = None
    average_rating: AppRating = Field(None, validation_alias="ratings")
    is_development: Annotated[
        bool,
        BeforeValidator(_is_development_status),
    ] = Field(False, validation_alias="status")

    @model_validator(mode="after")
    def populate_widgets(self) -> "VendorAppSchema":
        widget_metadata = get_widget_metadata(self.apps_json_cache, self.widgets_json_cache)
        self.widgets = widget_metadata.get("widgets", []) if widget_metadata else []
        self.total_widgets = widget_metadata.get("totalWidgets", 0) if widget_metadata else 0
        return self


class ReturnApiSource(ApiSourceBase, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config(from_attributes=True)
    uuid: UUID
    id_: UUID = Field(serialization_alias="id", alias="uuid")
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")
    is_entity_backend: Annotated[bool, BeforeValidator(_is_not_none)] = Field(validation_alias="entity_uuid")
    vendor_app: VendorAppSchema | None = Field(None, validation_alias="vendor_app")


class EntityTypeCreate(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    entity_type: str
    code: str
    active: bool
    permission_hierarchy: int


class EntityTypeReturn(EntityTypeCreate):  # type: ignore[call-arg]
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID


class EntityBase(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    name: str
    entity_code: str
    email: EmailStr
    company_type: str
    organization_size: str
    aum: int
    country: str
    sharing_enabled: bool


class EntityPost(EntityBase):
    admin_email: EmailStr
    sharing_enabled: bool = True


class EntityReturn(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID
    name: str
    entity_type: EntityTypeReturn
    email: None | str
    company_type: None | str
    organization_size: None | str
    aum: None | int
    country: None | str
    sharing_enabled: bool


class EntityRelationshipCreate(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    parent_uuid: UUID
    child_uuid: UUID


class EntityRelationshipGet(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    parent_uuid: UUID
    child_uuid: UUID


class EntityRelationshipReturn(EntityRelationshipCreate, extra="forbid"):  # type: ignore[call-arg]
    parent: EntityReturn
    child: EntityReturn
    supreme: EntityReturn
    uuid: UUID


class UserAdminUpdate(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    permissions_uuid: None | UUID = None


class EntityMapCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    entity_uuid: UUID
    name: UserType


class EntityMapReturn(EntityMapCreate):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID
    entity: EntityReturn
    name: str


class EntityUserReturn(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID
    email: str
    permissions: EntityMapReturn | None = None


class AddEntityReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    entity_uuid: UUID
    permission_map_uuid: UUID


class DashboardReturn(BaseModel):
    model_config = main_config
    creator: bool
    content: None | dict
    created_date: datetime
    updated_date: datetime
    created_by: str
    is_shared: bool | None = False


# The keys of a saved widget's endpoint that carried a data backend's credentials, which
# widgets look up in the data backend when they fetch
ENDPOINT_CREDENTIAL_KEYS = frozenset({"headers", "query"})


def strip_endpoint_credentials(content: Any) -> Any:
    """Saved dashboard or app content without any data backend's credentials: no widget
    endpoint keeps its headers or query values, and no backend's header rows
    (`endpointHeaders`) are kept."""
    if isinstance(content, list):
        return [strip_endpoint_credentials(item) for item in content]
    if not isinstance(content, dict):
        return content
    stripped = {
        key: strip_endpoint_credentials(value)
        for key, value in content.items()
        if key != "endpointHeaders"
    }
    if isinstance(endpoint := stripped.get("endpoint"), dict):
        stripped["endpoint"] = {
            key: value
            for key, value in endpoint.items()
            if key not in ENDPOINT_CREDENTIAL_KEYS
        }
    return stripped


class DashboardsCreate(BaseModel):
    items: dict[UUID, Literal["DELETE"] | dict]

    @field_validator("items")
    @classmethod
    def strip_credentials(
        cls, items: dict[UUID, Literal["DELETE"] | dict]
    ) -> dict[UUID, Literal["DELETE"] | dict]:
        return {
            uuid: strip_endpoint_credentials(content) for uuid, content in items.items()
        }


class DashboardOwned(BaseModel):
    owned: dict[UUID, DashboardReturn]


class DashboardShared(BaseModel):
    shared: dict[UUID, DashboardReturn]
    entity_shared: dict[UUID, DashboardReturn]


class DashboardComplete(DashboardOwned, DashboardShared):
    pass


class UserAccess(BaseModel):
    """What a user may do, from their type and the roles an admin assigned them."""

    model_config = main_config
    user_type: UserType | None
    sharing: SharingLevel
    excel_add_in: bool


class UserLimits(BaseModel):
    """A user's daily limits, from their roles. None is no limit."""

    copilot_calls_day: int | None
    copilot_tokens_day: int | None
    upload_size_gb: int | None


class UsageBase(BaseModel):
    model_config = main_config
    number_copilot_calls_day_count: int
    number_copilot_tokens_day_count: int = 0
    total_file_upload_size_gb_count: float


class UsagePut(BaseModel):
    """Usage reported by the service that serves the Copilot, never by users."""

    add_copilot_count: int | None = Field(0, ge=0)
    subtract_copilot_count: int | None = Field(0, ge=0)
    reset_copilot_count: bool | None = False
    add_copilot_tokens: int | None = Field(0, ge=0)


class UsageGet(UsageBase, extra="ignore"):  # type: ignore[call-arg]
    copilot_calls_limit: int | None = None
    copilot_tokens_limit: int | None = None
    file_upload_size_limit: float | None = None

    @classmethod
    async def check_cache(cls, db, user) -> "UsageGet":
        from routers.app.helpers import check_usage_cache  # noqa: PLC0415

        return await check_usage_cache(db, user)


class UsageLimitError(BaseModel):
    error: str
    message: str
    current_usage: int

    @classmethod
    def limit_error(cls, usage: UsageGet, tokens: bool = False) -> JSONResponse:
        if tokens:
            message = (
                "The daily token limit of "
                f"{usage.copilot_tokens_limit} has been reached"
            )
            current_usage = usage.number_copilot_tokens_day_count
        else:
            message = (
                "Cannot increment usage beyond the maximum limit of "
                f"{usage.copilot_calls_limit}"
            )
            current_usage = usage.number_copilot_calls_day_count
        return JSONResponse(
            status_code=422,
            content={
                "error": "Maximum usage limit reached",
                "message": message,
                "current_usage": current_usage,
            },
        )


def default_chats() -> list["Chat"]:
    current_at = int(datetime.now(UTC).timestamp() * 1000)
    DEFAULT_CHAT = {
        "uuid": str(uuid4()),
        "createdAt": current_at,
        "label": "New chat",
        "messages": [],
        "titleManuallyUpdated": False,
        "titleNeedsUpdate": True,
        "lastOpened": current_at,
    }
    return [Chat.model_validate(DEFAULT_CHAT)]


class DashboardCompleteWithContext(DashboardComplete):
    model_config = main_config
    can_submit_marketplace: bool = False
    access: UserAccess | None = None
    usage: UsageGet | None = None
    copilot_chats: list["ChatInfo | Chat"] | None = Field(default_factory=default_chats)
    questions_history: list[str] | None = None
    mcp_servers: list[dict] | None = Field(default_factory=list)
    display_settings: UserDisplaySettings = UserDisplaySettings()
    entity_theme_settings: "EntityThemeSettings"
    file_widgets: list[ReturnFileWidget]
    user_apps: "UserAppsComplete"
    user_skills: list["SkillReturn"] | None = Field(default_factory=list)
    widget_metadata: list["WidgetMetadataResponse"] | None = None
    copilot_access: "CopilotAccess | None" = None


class DashboardSave(BaseModel):
    model_config = main_config
    content: dict
    uuid: UUID
    created_date: datetime


class UserEntityInfo(BaseModel):
    model_config = main_config
    entity_name: str
    permission_name: str


class AppUserReturn(BaseModel):
    model_config = main_config
    expiration_date: datetime
    first_name: None | str = None
    last_name: None | str = None
    display_settings: UserDisplaySettings = UserDisplaySettings()
    file_widgets: list[ReturnFileWidget]
    api_sources: list[ReturnApiSource]
    username: None | str = None
    email: str
    uuid: UUID
    widget_metadata: list["WidgetMetadataResponse"] | None = None
    entity_info: UserEntityInfo | None = None


class UserAdminReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID
    first_name: None | str = None
    last_name: None | str = None
    email: str
    role: str
    last_login: None | datetime = None
    last_active: None | datetime = None
    status: Literal["active", "pending", "revoked", "expired"] = "pending"
    permissions_uuid: UUID | None = None
    # Which table the information comes from, essential for properly implementing a delete function
    source: UserSourceType


class UserCreateAdmin(BaseModel):
    model_config = main_config
    email: Annotated[EmailStr, AfterValidator(check_email)]
    permissions_uuid: UUID
    first_name: None | str = None
    last_name: None | str = None
    message: None | str = Field(max_length=500, default=None)
    role: None | UUID = None


class UserCreateAppAdmin(BaseModel):
    model_config = main_config
    email: Annotated[EmailStr, AfterValidator(check_email)]
    permissions_uuid: UUID
    first_name: None | str = None
    last_name: None | str = None
    message: None | str = Field(max_length=500, default=None)


class UserUpdateAdmin(BaseModel):
    model_config = main_config
    permissions_uuid: None | str = None


class TotpToken(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    totp_token: Annotated[None | int, AfterValidator(check_totp_token)] = None


class TotpActivate(TotpToken):
    """POST /totp/activate. A pending enrollment finishes its sign-in, which keeps the
    sign-in's `remember` and `version` (POST /app/login)."""

    remember: bool = False
    version: None | str = None


class UserLogin(BaseModel):
    model_config = main_config
    email: Annotated[str, AfterValidator(check_email_or_username)]
    remember: bool = False
    totp_token: Annotated[None | int, AfterValidator(check_totp_token)] = None
    password: Annotated[str, AfterValidator(check_password)]

    _bypass_password_check: bool = False


class AppUserLogin(UserLogin):
    source: None | AppLoginSource = None
    version: None | str = None


class OAuthLogin(AppUserLogin):
    password: str | None = None

    def bypass_password_check(self):
        self._bypass_password_check = True

        return self


class UserUpdate(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    old_password: Annotated[None | str, AfterValidator(check_password)] = None
    new_password: Annotated[None | str, AfterValidator(check_password)] = None

    def validated_dict(self, password: str):
        """Converts the model into a dictionary, valid for updating the user model.

        Parameters
        ----------
        password: str
            The user's old password hashed, used to validated old_password
        """
        if isinstance(password, bytes):
            password = password.decode("utf-8")

        new_dict = self.model_dump(exclude_none=True)
        old_pass = new_dict.pop("old_password", None)
        new_pass = new_dict.pop("new_password", None)
        if old_pass and new_pass:
            valid = base.verify_password(old_pass, password)
            if not valid:
                raise ValueError("Invalid password")
            new_dict["password"] = new_pass
            new_dict["temporary_password"] = False
        return new_dict


class ShareDashboard(BaseModel):
    model_config = main_config
    # For right now, we are NOT allowing edit
    shares: SharesPermissions


class ShareUserApp(ShareDashboard):
    pass


class ShareDashboardList(BaseModel):
    model_config = main_config
    # For right now, we are NOT allowing edit
    shares: list[Annotated[str, AfterValidator(check_email)]]


class ShareUserAppList(ShareDashboardList):
    pass


class RegisterAppUser(BaseModel):
    # None for a user who signs up through single sign-on: nobody invited them
    inviting_uuid: None | UUID = None


ForceInt = Annotated[int, BeforeValidator(int)]


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)
    uuid: UUID | None = Field(default=None)
    role: base.ChatMessageRole
    copilotId: str
    timestamp: ForceInt
    content: str | dict | None = None
    isError: None | bool = None
    isFC: None | bool = None
    function: None | str = None
    input: None | dict = None
    copilot_function_call_arguments: None | dict = None
    isHidden: None | bool = None
    usedPersonalOpenAiKey: None | bool = None
    citations: None | list[dict] = None
    data: None | dict | list[dict] = None
    extra_state: None | dict = None

    @field_validator("usedPersonalOpenAiKey", mode="before", check_fields=False)
    @classmethod
    def check_used_personal_openai_key(cls, value: str | bool | None) -> bool:
        return bool(value)


def parse_created_at(value: datetime | int | None) -> int:
    if value is None:
        return int(datetime.now(UTC).timestamp() * 1000)
    if isinstance(value, datetime):
        return int(value.timestamp() * 1000)
    return value


class ChatInfo(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)
    uuid: str | UUID | None = Field(default=None, serialization_alias="uuid", alias="id")
    createdAt: Annotated[int, BeforeValidator(parse_created_at)]
    label: str

    @classmethod
    def corrupted(cls, uuid: UUID) -> "Chat":
        """Creates a corrupted chat object with the given UUID."""
        return cls(
            uuid=uuid,
            createdAt=int(datetime.now(UTC).timestamp() * 1000),
            label="Corrupted Chat",
            messages=[
                ChatMessage(
                    uuid=uuid4(),
                    role="system",
                    content={
                        "eventType": "ERROR",
                        "message": "This chat contains corrupted data and cannot be displayed.",
                    },
                    timestamp=int(datetime.now(UTC).timestamp() * 1000),
                    copilotId="default-copilot",
                )
            ],
            lastOpened=int(datetime.now(UTC).timestamp() * 1000),
        )

    def to_content(self) -> dict:
        """Converts the Chat object to a dictionary suitable for database storage."""
        return self.model_dump(mode="json", exclude={"messages", "artifacts"}, by_alias=True)


class Chat(ChatInfo):
    artifacts: list[dict] | None = Field(default_factory=list)
    messages: list[ChatMessage]

    @classmethod
    def from_row(cls, row: "CopilotChat", from_search: bool = False) -> "ChatInfo | Chat":
        if (value := row.content) is None:
            return cls.corrupted(row.uuid)

        value.pop("id_", None)
        value.pop("id", None)
        value.update({"uuid": row.uuid})
        if not hasattr(row, "messages"):
            return ChatInfo.model_validate(value)

        value.update({"messages": [v.content for v in row.messages if v.content is not None]})
        if not from_search:
            value.update({"artifacts": row.artifacts if hasattr(row, "artifacts") else []})
        return cls.model_validate(value)


class ChatUpdate(Chat):
    messages: dict[UUID, Literal["DELETE"] | dict] = Field(default_factory=dict)

    def to_entry(self, chat_uuid: UUID, owner_uuid: UUID):
        """Converts the ChatUpdate object to a dictionary suitable for database storage."""
        v = self.model_dump(mode="json", by_alias=True)
        v.pop("id_", None)
        v.pop("id", None)
        messages: dict[str, Literal["DELETE"] | dict] = v.pop("messages", {})
        artifacts: list[dict] = v.pop("artifacts", [])
        entry = {
            "uuid": chat_uuid,
            "content": v,
            "artifacts": artifacts,
            "label": v.get("label"),
            "last_opened": base.time_ms_now(v.get("lastOpened")),
            "user_uuid": owner_uuid,
        }
        return (entry, messages)


class CopilotChatsCreate(BaseModel):
    chats: dict[UUID, Literal["DELETE"] | ChatUpdate]


class MCPTool(BaseModel):
    model_config = get_camel_config(extra="ignore", from_attributes=True)
    id_: str = Field(serialization_alias="id", alias="id")
    name: str
    description: str | None = None
    enabled: bool = True


MCPHeaderName = Annotated[
    str, StringConstraints(pattern=r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$", max_length=100)
]
MCPHeaderValue = Annotated[str, StringConstraints(pattern=r"^[^\r\n\x00]*$", max_length=8192)]


class MCPServer(BaseModel):
    model_config = get_camel_config(extra="allow", from_attributes=True)
    id_: str = Field(serialization_alias="id", alias="id")
    client_name: str | None = None
    tools: list[MCPTool] = Field(default_factory=list)
    name: str
    url: str
    enabled: bool
    is_local: bool = False
    # Write-only: a value sets that header, null removes it, a header left out keeps the
    # stored value. Header values are stored encrypted and never sent back.
    custom_headers: dict[MCPHeaderName, MCPHeaderValue | None] | None = Field(
        default=None, exclude=True
    )
    # What is stored for the server: the names of its custom headers, and whether one of
    # them is an Authorization header (a token-auth server)
    custom_header_names: list[str] = Field(default_factory=list)
    has_token: bool = False

    def stored_fields(self) -> dict:
        """The server as the non-secret server list stores it."""
        return self.model_dump(exclude={"custom_header_names", "has_token"})


class MCPServers(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    servers: list[MCPServer] = Field(default_factory=list)

    def get_servers_json(self):
        return self.model_dump(by_alias=True).get("servers", [])


class MCPLocalServer(BaseModel):
    """A saved MCP server on the user's machine (POST /app/mcp-servers/local-headers), in
    the body: never in a query string."""

    model_config = main_config
    url: str = Field(max_length=2048)


class MCPServerHeaders(BaseModel):
    """The stored headers of a local MCP server, which the browser connects to itself."""

    model_config = main_config
    headers: dict[str, str]


def mcp_header_flags(headers: dict[str, str] | None) -> dict[str, list[str] | bool]:
    """The fields that describe a server's stored headers without their values."""
    names = sorted(headers) if headers else []
    return {
        "custom_header_names": names,
        "has_token": any(name.lower() == "authorization" for name in names),
    }


def normalize_mcp_url(url: str) -> str:
    """The form in which MCP server URLs are stored and compared: scheme and host in
    lower case, no query, fragment or trailing slash."""
    parsed = urlsplit(url.strip())
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


def mcp_server_url(url: str) -> str:
    """An MCP server URL as the API keeps a sign-in for it: normalized, http or https,
    with a host and no credentials in its authority."""
    normalized = normalize_mcp_url(url)
    parsed = urlsplit(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("The MCP server URL must be an http or https URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("The MCP server URL must not carry credentials")
    return normalized


class MCPOAuthServer(BaseModel):
    """The MCP server to sign the user in to (POST /app/mcp-oauth/start) or to forget the
    sign-in of (POST /app/mcp-oauth/disconnect), in the body: never in a query string."""

    model_config = main_config
    server_url: Annotated[str, Field(max_length=2048), AfterValidator(mcp_server_url)]


class MCPOAuthAuthorization(BaseModel):
    """Where the user signs in to an MCP server: the authorization server's page, which
    sends the browser back to the web app's /oauth/callback."""

    model_config = main_config
    authorization_url: str


class MCPOAuthCallback(BaseModel):
    """The authorization server's answer, as the web app's /oauth/callback page got it."""

    model_config = main_config
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=1, max_length=512)


class MCPOAuthCompleted(BaseModel):
    """The MCP server the user is now signed in to, by its normalized URL."""

    model_config = main_config
    server_url: str


ALL_MCP_TOOLS = "*"


class CopilotModelGrant(BaseModel):
    """A model of a Copilot agent."""

    model_config = main_config
    agent_id: str = Field(min_length=1, max_length=255)
    model_id: str = Field(min_length=1, max_length=255)


class McpGrant(BaseModel):
    """An MCP server, or one of its tools (`*` for all of them)."""

    model_config = main_config
    server_url: str = Field(min_length=1, max_length=400)
    tool_name: str = Field(default=ALL_MCP_TOOLS, min_length=1, max_length=200)

    @field_validator("server_url")
    @classmethod
    def normalize_url(cls, value: str) -> str:
        return normalize_mcp_url(value)


class RoleCopilotAccess(BaseModel):
    """The Copilot models and MCP tools that a role grants. Empty lists grant nothing."""

    model_config = main_config
    models: list[CopilotModelGrant] = Field(default_factory=list)
    mcp: list[McpGrant] = Field(default_factory=list)


class CopilotAccess(RoleCopilotAccess):
    """What a user may use: the union of what their roles grant."""


class CopilotToolRef(BaseModel):
    model_config = main_config
    url: str
    tool_name: str


class CopilotAuthorize(BaseModel):
    """A Copilot request, as the service that serves the Copilot is about to run it."""

    model_config = main_config
    agent_id: str | None = None
    model: str | None = None
    tools: list[CopilotToolRef] = Field(default_factory=list)


ProviderKey = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1024, pattern=r"^\S+$")
]


class CopilotProviderKeys(BaseModel):
    """A user's own Copilot provider keys.

    As the body of PUT /app/copilot-keys: a key sets it, null clears it, a key left out
    stays as it is.
    """

    model_config = main_config
    openai_api_key: ProviderKey | None = None
    perplexity_api_key: ProviderKey | None = None


class CopilotKeysStatus(BaseModel):
    """Which of the user's own provider keys are stored; the values never leave the API."""

    model_config = main_config
    has_openai_key: bool = False
    has_perplexity_key: bool = False


class CopilotAuthorizeResult(BaseModel):
    model_config = main_config
    allowed: bool
    denied_model: str | None = None
    denied_tools: list[CopilotToolRef] = Field(default_factory=list)
    # The user's own provider keys, decrypted: in the answer to the default Copilot (an
    # agent token) only
    provider_keys: CopilotProviderKeys | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class AppUserSchema(BaseModel):
    "A schema for the user of the app"

    model_config = {"from_attributes": True, "populate_by_name": True}

    email: str
    uuid: UUID
    username: str | None = None
    confirmed: bool
    password: str
    latest_version: str | None = None
    permissions_uuid: None | UUID = None
    temporary_password: None | bool = None
    totp_secret: None | str = None
    totp_active: bool | None = None
    two_factor_auth: bool | None = None
    entity_uuid: UUID | None = None
    require_authenticator: bool | None = None
    name: str | None = None
    role: str | None = None
    is_superuser: bool | None = None
    can_submit_marketplace: bool | None = None


class StoredFileSchema(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID | None = Field(default_factory=uuid4)
    creater_uuid: UUID
    s3_file_name: str
    bucket: str
    extension: ExtensionType
    original_file_name: None | str
    size: int

    failed: bool = False

    def as_return(self) -> "PendingFileReturn":
        return PendingFileReturn(
            stored_file_uuid=self.uuid,
            original_file_name=self.original_file_name,
            extension=self.extension,
            url=f"{settings.SELFURL}/app/files/{self.uuid}.{self.extension}",
            failed=self.failed,
        )

    def set_failed(self) -> "StoredFileSchema":
        updated = self.model_copy(update={"failed": True})
        return updated


class StoredFileReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID
    file_widget_uuid: UUID | None = None
    extension: ExtensionType
    original_file_name: None | str
    size: int | None = None
    is_global: bool = False


class DownloadManifest(StoredFileReturn):
    model_config = {"from_attributes": True, "populate_by_name": True}

    uuid: UUID | None = None
    file_name: str | None = None

    @model_validator(mode="after")
    def check_file_name(self):
        if not self.file_name:
            self.file_name = f"{self.uuid}.{self.extension}"
        return self


class DeleteStoredFiles(BaseModel):
    file_uuids: list[UUID]


class WidgetMetadataResponse(BaseModel):
    model_config = get_camel_config()
    name: str
    description: str
    source: str
    category: str
    sub_category: str
    widget_type: MetaDataWidgetType
    storage: dict
    widget_config: dict | None = None
    widget_id: UUID


class WidgetMetadataResponsePatch(BaseModel):
    model_config = get_camel_config()
    name: str | None = None
    description: str | None = None
    source: str | None = None
    category: str | None = None
    sub_category: str | None = None
    widget_type: MetaDataWidgetType | None = None
    widget_config: dict | None = None
    storage: dict | None = None


class UserAppCreate(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True, populate_by_name=True)
    name: str
    description: str | None = None
    img: str | None = None
    img_dark: str | None = None
    img_light: str | None = None
    prompts: list[str] = Field(default_factory=list)
    widgets: list[dict] = Field(default_factory=list)
    groups: list[dict] = Field(default_factory=list)
    gridLayout: dict[str, list[dict]] = Field(default_factory=dict)
    currentTab: str | None = None

    @model_validator(mode="before")
    @classmethod
    def strip_credentials(cls, content: Any) -> Any:
        return strip_endpoint_credentials(content)


class UserAppReturn(BaseModel):
    model_config = get_camel_config(from_attributes=True)
    content: UserAppCreate
    creator: bool
    is_shared: bool | None = False
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")
    created_by: str = Field(serialization_alias="createdBy", alias="created_by")
    sharedWith: list[dict] | None = Field(default_factory=list, serialization_alias="sharedWith", alias="shared_with")


class UserAppShareReturn(BaseModel):
    created_date: None | datetime
    permissions: None | base.PermissionEnum
    first_name: None | str
    last_name: None | str
    # A developer's share that waits for an admin's approval
    pending: bool = False


class UserAppsComplete(BaseModel):
    shared: dict[UUID, UserAppReturn]
    owned: dict[UUID, UserAppReturn]


class SharedDashboardViewed(BaseModel):
    dashboard_uuid: UUID
    viewed: bool


class SharedAppViewed(BaseModel):
    app_uuid: UUID
    viewed: bool


class SignInNonce(BaseModel):
    """POST /app/sign-in/nonce: the nonce that the ID token of the browser's next sign-in
    with Microsoft or Okta must carry."""

    model_config = main_config
    nonce: str


class AuthData(BaseModel):
    """A sign-in with a provider: Google's access token, or the ID token Microsoft or Okta
    issued to this deployment's client with the browser's sign-in nonce (their access
    token, `token`, is not used)."""

    model_config = main_config

    token: str | None = Field(default=None, max_length=8192)
    id_token: str | None = Field(default=None, max_length=16384)
    version: None | str = None


class CustomCopilot(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID | None = Field(default_factory=uuid4)
    url: str
    headers: dict[str, str]
    copilots: list[dict] | None = Field(default_factory=list)


class Prompt(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)
    id: str
    prompt: str
    widgets: list | None = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class SkillCreate(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config(from_attributes=True)
    slug: str
    description: str
    content: str

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        if len(value) < 2 or len(value) > 50:  # noqa: PLR2004
            raise ValueError("Skill slug must be between 2 and 50 characters")
        if not SKILL_SLUG_REGEX.match(value):
            raise ValueError("Skill slug must contain only lowercase letters, numbers, and hyphens")
        return value


class SkillReturn(SkillCreate):
    model_config = get_camel_config(from_attributes=True)

    uuid: UUID
    id_: UUID = Field(serialization_alias="id", alias="uuid")
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")


class TwoFactorAuth(BaseModel):
    model_config = main_config
    two_factor_auth: bool


class TwoFactorAuthGet(TwoFactorAuth):
    entity_require_authenticator: bool


# The daily limits of a role; null is no limit
ROLE_LIMITS = ("copilot_calls_day", "copilot_tokens_day", "upload_size_gb")


class GetRoleWithUsers(BaseModel):
    model_config = main_config
    uuid: UUID
    name: str
    description: str
    updated_date: datetime
    users: list[EmailStr]
    sharing: SharingLevel
    copilot_calls_day: int | None
    copilot_tokens_day: int | None
    upload_size_gb: int | None
    excel_add_in: bool

    @classmethod
    def from_role(cls, role, users: list[str]) -> "GetRoleWithUsers":
        return cls(
            uuid=role.uuid,
            name=role.name,
            description=role.description,
            updated_date=role.updated_date,
            users=users,
            sharing=role.sharing,
            copilot_calls_day=role.copilot_calls_day,
            copilot_tokens_day=role.copilot_tokens_day,
            upload_size_gb=role.upload_size_gb,
            excel_add_in=role.excel_add_in,
        )


class PostRole(BaseModel):
    model_config = main_config
    uuid: UUID | None = None
    name: str
    description: str
    users: list[EmailStr] | None = None
    sharing: SharingLevel = "none"
    # A new role has no limits: its members may use whatever it grants
    copilot_calls_day: int | None = Field(None, ge=0)
    copilot_tokens_day: int | None = Field(None, ge=0)
    upload_size_gb: int | None = Field(None, ge=0)
    excel_add_in: bool = False


class PatchRole(BaseModel):
    model_config = main_config
    name: str | None = None
    description: str | None = None
    users: list[EmailStr] | None = None
    sharing: SharingLevel | None = None
    copilot_calls_day: int | None = Field(None, ge=0)
    copilot_tokens_day: int | None = Field(None, ge=0)
    upload_size_gb: int | None = Field(None, ge=0)
    excel_add_in: bool | None = None

    def changes(self) -> dict[str, Any]:
        """The role fields to set: the ones sent, where a null limit is no limit."""
        return {
            key: value
            for key, value in self.model_dump(
                exclude={"users"}, exclude_unset=True
            ).items()
            if value is not None or key in ROLE_LIMITS
        }


class WidgetAccess(BaseModel):
    widgetId: str
    access: AccessType


class PromptAccess(BaseModel):
    promptId: str
    access: AccessType


class TemplateAccess(BaseModel):
    templateId: str
    access: AccessType
    prompts: list[PromptAccess] | None = None


class AppReturn(BaseModel):
    uuid: UUID
    name: str
    url: str
    user_uuid: UUID
    user_email: str | None = None
    created_date: datetime
    updated_date: datetime


class RolePermissions(BaseModel):
    model_config = main_config
    uuid: UUID
    type: Literal["backend", "file", "prompt"]
    access: AccessType
    category: Literal["data-connectors", "templates", "prompts"]
    widgets: list[WidgetAccess] | None = None
    templates: list[TemplateAccess] | None = None
    file_extension: ExtensionType | None = None
    prompt: Prompt | None = None


class BackendPermissionsModel(BaseModel):
    model_config = main_config
    uuid: UUID
    name: str
    access: AccessType
    widgets: list[WidgetAccess] | None = None
    templates: list[TemplateAccess] | None = None
    url: str | None = None
    endpointHeaders: list[ApiSourceEndpointHeaders] | None = None
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")
    created_by: str | None = Field(serialization_alias="createdBy", alias="created_by")


class FilePermissionsModel(BaseModel):
    model_config = main_config
    uuid: UUID
    access: AccessType
    name: str
    description: str
    url: str | None = None
    stored_file_uuid: UUID | None = None

    @model_validator(mode="after")
    def check_stored_file_uuid(self):
        if not self.stored_file_uuid and self.url:
            try:
                uuid_str = self.url.split("/").pop().split(".")[0]
                self.stored_file_uuid = UUID(uuid_str)
            except ValueError:
                self.stored_file_uuid = None
        return self


class PromptPermissionsModel(BaseModel):
    model_config = main_config
    uuid: UUID
    access: AccessType
    prompt: Prompt


class UserRolePermissions(BaseModel):
    model_config = main_config
    backends: list[BackendPermissionsModel] | None = Field(default_factory=list)
    files: list[FilePermissionsModel] | None = Field(default_factory=list)
    prompts: list[PromptPermissionsModel] | None = Field(default_factory=list)


class UserRolesPermissions(BaseModel):
    model_config = main_config
    permissions: dict[UUID, UserRolePermissions] = Field(default_factory=dict)


class UserRolesPermissionsFlattened(BaseModel):
    model_config = main_config
    backends: list[BackendPermissionsModel] | None = Field(default_factory=list)
    files: list[FilePermissionsModel] | None = Field(default_factory=list)
    prompts: list[PromptPermissionsModel] | None = Field(default_factory=list)


class RoleAuditLogReturn(BaseModel):
    """Return model for audit logs"""

    uuid: UUID
    created_at: datetime
    entity_uuid: UUID
    role_uuid: None | UUID = None
    action: RoleAuditAction
    resource_type: RoleResourceType
    resource_uuid: UUID
    performed_by_email: str
    details: dict
    role_name: str
    details_msg: str | None = None


class UserPermissions(BaseModel):
    data_connectors: list[dict]
    templates: list[dict]
    prompts: list[dict]


class ThemeSettings(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)
    appTheme: dict | None = None


class EntityThemeSettings(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    light: ThemeSettings | None = None
    dark: ThemeSettings | None = None


class AppToken(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID
    email: EmailStr
    # The session token, for the client that is not a browser only (the Excel add-in).
    # The web app's session is an HttpOnly cookie it never sees.
    access_token: str | None = Field(default=None, exclude_if=lambda value: value is None)
    username: str | None
    expiration_date: datetime
    temporary_password: bool
    force_2fa: bool
    entity_name: None | str
    entity_theme_settings: EntityThemeSettings
    role: None | str
    show_changelog: bool


class AppTokenWithContext(AppToken):
    copilot_chats: list["ChatInfo | Chat"] | None = None
    questions_history: list[str] | None = None
    dash_sync: DashboardComplete | None = None
    user_apps: UserAppsComplete
    user_skills: list[SkillReturn] | None = None
    user: AppUserReturn | None = None
    access: UserAccess | None = None
    can_submit_marketplace: bool = False
    usage: UsageGet | None = None
    custom_copilots: list[CustomCopilot] | None = None
    mcp_servers: list[MCPServer] | None = None
    copilot_keys: CopilotKeysStatus | None = None
    is_first_login: bool | None = False


class SessionUser(BaseModel):
    model_config = main_config
    first_name: None | str = None
    last_name: None | str = None
    display_settings: UserDisplaySettings = UserDisplaySettings()


class AppSession(BaseModel):
    """GET /app/session: the signed-in user, as the web app needs it after a reload."""

    model_config = main_config
    uuid: UUID
    email: EmailStr
    username: str | None
    expiration_date: datetime
    temporary_password: bool
    force_2fa: bool
    entity_name: None | str
    role: None | str
    access: UserAccess
    can_submit_marketplace: bool = False
    usage: UsageGet | None = None
    copilot_keys: CopilotKeysStatus
    user: SessionUser
