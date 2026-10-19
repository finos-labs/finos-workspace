import json
import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Annotated, Any, Literal, TypeVar
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

from fastapi.responses import JSONResponse
from pydantic import (
    AliasGenerator,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    alias_generators,
    field_validator,
    model_validator,
)
from pydantic.functional_validators import AfterValidator, BeforeValidator
from pydantic.networks import IPvAnyAddress

from api import base
from api.events.types import RoleAuditAction, RoleResourceType
from utilities.config import BaseModel, settings

if TYPE_CHECKING:
    from api.models.workspace_models import CopilotChat, StoredFile


StoredFileT = TypeVar("StoredFileT", bound="StoredFile")

main_config = ConfigDict(extra="forbid", from_attributes=True)
# Where a login came from. "sdk" is gone with the SDK token endpoints; this is what a client
# may send, not what is read back, so logins already recorded as "sdk" are unaffected.
source_type = Literal["app", "oauth-app"]
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
BundleNames = Literal["Default", "Equity Research", "On-Premise"]


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


def check_username(v: None | str) -> None | str:
    if v:
        result = username_check(v)
        if result:
            raise ValueError(result)
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


def datetime_to_string(v: str | datetime | None):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def blank_to_none(v: None | str) -> None | str:
    if not v:
        return None
    return v


def get_camel_config(**config: ConfigDict) -> ConfigDict:
    return ConfigDict(
        **config,
        populate_by_name=True,
        alias_generator=AliasGenerator(alias=alias_generators.to_camel),
    )


def _is_not_none(v) -> bool:
    return v is not None


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


class ResetPasswordReturn(SuccessReturn):
    temporary_password: str


class DashboardShareReturn(BaseModel):
    created_date: None | datetime
    permissions: None | base.PermissionEnum
    first_name: None | str
    last_name: None | str


class TotpGenerateReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uri: str
    secret: str


class ContentReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    content: str


class MessageReturn(SuccessReturn, extra="ignore"):  # type: ignore[call-arg]
    message: str


class UrlReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    url: None | str = None


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


class CodeReturn(BaseModel):
    code: str
    used: bool


class Token(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    username: None | str = None
    email: str
    access_token: str
    token_type: str
    uuid: UUID


class FullToken(Token, extra="ignore"):  # type: ignore[call-arg]
    has_app: bool


class TokenData(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    email: None | EmailStr = None


class LogCreate(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    request: str
    error: str
    status_code: int
    method: str


class Email(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    message: str


class UUIDReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    uuid: UUID


class UserDisplaySettings(BaseModel, extra="allow"):  # type: ignore[call-arg]
    theme: Literal["light", "dark"] | None = None
    showWidgetControls: bool = False
    virtualizeWidgets: bool = False
    fontSize: Literal["small", "medium", "large"] = "medium"
    gridCorners: list[Literal["ne", "nw", "se", "sw"]] = ["se"]
    gridSnapping: Literal["off", "vertical"] = "vertical"
    quickAddButtonTransparent: bool = False
    lastVisitedPage: str | None = "/app"


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
    pass


class ReturnApiSource(ApiSourceBase, extra="ignore"):  # type: ignore[call-arg]
    model_config = get_camel_config(from_attributes=True)
    uuid: UUID
    id_: UUID = Field(serialization_alias="id", alias="uuid")
    created_date: datetime = Field(serialization_alias="createdDate", alias="created_date")
    updated_date: datetime = Field(serialization_alias="updatedDate", alias="updated_date")
    is_entity_backend: Annotated[bool, BeforeValidator(_is_not_none)] = Field(validation_alias="entity_uuid")


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
    seats: int
    expiration_date: datetime


class EntityPost(EntityBase):
    admin_email: EmailStr


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
    seats: None | int
    expiration_date: Annotated[None | str, BeforeValidator(datetime_to_string)]


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
    billing_active: None | bool = None


class EntityMapCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    entity_uuid: UUID
    name: str


class EntityMapReturn(EntityMapCreate):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    uuid: UUID
    entity: EntityReturn
    name: str


class EntityInfoReturn(BaseModel):
    seats: int
    used_seats: int
    expiration_date: None | datetime


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


class DashboardsCreate(BaseModel):
    items: dict[UUID, Literal["DELETE"] | dict]


class DashboardOwned(BaseModel):
    owned: dict[UUID, DashboardReturn]


class DashboardShared(BaseModel):
    shared: dict[UUID, DashboardReturn]
    entity_shared: dict[UUID, DashboardReturn]


class DashboardComplete(DashboardOwned, DashboardShared):
    pass


class DataBundle(BaseModel):
    model_config = ConfigDict(extra="allow", from_attributes=True)

    bundle_name: BundleNames
    except_widgets: list[str] | None = None
    except_dashboard_templates: list[str] | None = None
    except_team_collaboration: list[Literal["pdf_reports", "sharing"]] | None = None
    data_export: bool
    providers: list[str] | None
    dashboards_at_launch: list[str] | None
    my_dashboards: list[str] | None
    invite_your_colleagues: bool
    number_copilot_calls_day: int
    total_file_upload_size_gb: int
    allow_custom_backends: bool | None = True

    @field_validator(
        "except_widgets",
        "except_dashboard_templates",
        "except_team_collaboration",
        "providers",
        "dashboards_at_launch",
        "my_dashboards",
        mode="before",
        check_fields=False,
    )
    @classmethod
    def json_to_lists(cls, value: None | str | list) -> None | list:
        if value and isinstance(value, str):
            return json.loads(value)
        return value


class EntitlementBase(BaseModel):
    model_config = main_config

    tier: Literal["full", "basic"] | None = None
    number_copilot_calls_day: int = None
    number_copilot_tokens_day: int | None = None
    total_file_upload_size_gb: int = None
    share_widgets: Literal["public", "private"] | None = None
    bring_your_own_data: bool = None
    bring_your_own_copilot: bool = None
    admin_access: bool = None
    support: bool = None
    data_add_ons_redistribution: bool = None
    bundle_name: BundleNames | None = None
    allow_custom_backends: bool | None = True
    # The Copilot's tools for the web (see CopilotCapability). Unset or None is on.
    search_web: bool | None = True
    fetch_from_web: bool | None = True


class EntitlementGet(EntitlementBase):
    data_bundle_info: DataBundle | None = None


class EntitlementUsageBase(BaseModel):
    def entitlement_match_dump(self):
        entitlement_match = {}

        for field_name, field in self.__class__.model_fields.items():
            entitlement_match[field.json_schema_extra["entitlement_match"]] = getattr(self, field_name)
        return entitlement_match

    model_config = main_config
    number_copilot_calls_day_count: int = Field(..., json_schema_extra={"entitlement_match": "number_copilot_calls_day"})
    number_copilot_tokens_day_count: int = Field(
        0, json_schema_extra={"entitlement_match": "number_copilot_tokens_day"}
    )
    total_file_upload_size_gb_count: float = Field(
        ..., json_schema_extra={"entitlement_match": "total_file_upload_size_gb"}
    )


class EntitlementUsagePut(BaseModel):
    """Usage reported by the service that serves the Copilot, never by users."""

    add_copilot_count: int | None = Field(0, ge=0)
    subtract_copilot_count: int | None = Field(0, ge=0)
    reset_copilot_count: bool | None = False
    add_copilot_tokens: int | None = Field(0, ge=0)


class EntitlementUsageGet(EntitlementUsageBase, extra="ignore"):  # type: ignore[call-arg]
    copilot_calls_limit: int | None = None
    copilot_tokens_limit: int | None = None
    file_upload_size_limit: float | None = None

    @classmethod
    async def check_cache(cls, db, user) -> "EntitlementUsageGet":
        from routers.app.helpers import check_usage_cache  # noqa: PLC0415

        return await check_usage_cache(db, user)


class UsageLimitError(BaseModel):
    error: str
    message: str
    current_usage: int

    @classmethod
    def limit_error(cls, usage: EntitlementUsageGet, tokens: bool = False) -> JSONResponse:
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
    feature_entitlements: EntitlementGet | None = None
    usage: EntitlementUsageGet | None = None
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
    billing_active: None | bool = False
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


class ExternalUserLogin(BaseModel):
    model_config = main_config
    email: Annotated[str, AfterValidator(check_email_or_username)]
    remember: bool = False
    ip_address: Annotated[None | IPvAnyAddress, BeforeValidator(blank_to_none)] = None
    source: None | source_type = None
    totp_token: Annotated[None | int, AfterValidator(check_totp_token)] = None


class UserLogin(ExternalUserLogin):
    model_config = main_config
    password: Annotated[str, AfterValidator(check_password)]

    _bypass_password_check: bool = False


class AppUserLogin(UserLogin):
    version: None | str = None


class OAuthLogin(AppUserLogin):
    password: str | None = None

    def bypass_password_check(self):
        self._bypass_password_check = True

        return self


class UserJsonUpdate(BaseModel):
    model_config = main_config
    key: str
    value: Any = None


class UserUpdate(BaseModel, extra="forbid"):  # type: ignore[call-arg]
    first_name: None | str = None
    last_name: None | str = None
    old_password: Annotated[None | str, AfterValidator(check_password)] = None
    new_password: Annotated[None | str, AfterValidator(check_password)] = None
    email: Annotated[None | EmailStr, AfterValidator(check_email)] = None
    username: Annotated[None | str, AfterValidator(check_username)] = None

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


class UserReturn(BaseModel, extra="ignore"):  # type: ignore[call-arg]
    model_config = main_config
    confirmed: bool
    created_date: datetime
    first_name: None | str = None
    last_name: None | str = None
    referral_count: None | int = None
    email: str
    username: Annotated[None | str, AfterValidator(check_username)] = None
    referral_code: str


class UserReturnExpanded(UserReturn):
    model_config = main_config
    uuid: UUID


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


class MCPServer(BaseModel):
    model_config = get_camel_config(extra="allow", from_attributes=True)
    id_: str = Field(serialization_alias="id", alias="id")
    client_name: str | None = None
    tools: list[MCPTool] = Field(default_factory=list)
    name: str
    url: str
    enabled: bool
    is_local: bool = False
    custom_headers: dict[str, str] | None = Field(default_factory=dict)


class MCPServers(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    servers: list[MCPServer] = Field(default_factory=list)

    def get_servers_json(self):
        return self.model_dump(by_alias=True).get("servers", [])


def normalize_mcp_url(url: str) -> str:
    """The form in which MCP server URLs are stored and compared: scheme and host in
    lower case, no query, fragment or trailing slash."""
    parsed = urlsplit(url.strip())
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))


ALL_MCP_TOOLS = "*"


class CopilotCapability(StrEnum):
    """What an administrator can switch off in the Copilot, for an entity or for one user.

    Each stands for tools of the agent, whichever MCP server provides them (see
    ``CAPABILITY_MCP_TOOLS``). A capability that is on changes nothing: what the roles grant
    still decides. One that is off takes the tools away whatever the roles grant.
    """

    SEARCH_WEB = "SEARCH_WEB"
    FETCH_FROM_WEB = "FETCH_FROM_WEB"


# The MCP tools of each capability, by the name the tool has on its server.
CAPABILITY_MCP_TOOLS: dict[CopilotCapability, frozenset[str]] = {
    CopilotCapability.SEARCH_WEB: frozenset({"web_search"}),
    CopilotCapability.FETCH_FROM_WEB: frozenset({"fetch_webpage", "inspect_webpage"}),
}


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
    """The Copilot models and MCP tools that a role grants. Empty lists grant nothing and
    leave the user's access to that kind unrestricted."""

    model_config = main_config
    models: list[CopilotModelGrant] = Field(default_factory=list)
    mcp: list[McpGrant] = Field(default_factory=list)


class CopilotAccess(RoleCopilotAccess):
    """What a user may use: the union of what their roles grant, less what is switched off for them."""

    models_restricted: bool = False
    mcp_restricted: bool = False
    disabled_capabilities: list[CopilotCapability] = Field(default_factory=list)


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


class CopilotAuthorizeResult(BaseModel):
    model_config = main_config
    allowed: bool
    denied_model: str | None = None
    denied_tools: list[CopilotToolRef] = Field(default_factory=list)
    # What is switched off for the user, whether or not the request had tools of it: the agent tells the model.
    disabled_capabilities: list[CopilotCapability] = Field(default_factory=list)


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
    billing_active: None | bool = None
    entity_uuid: UUID | None = None
    require_authenticator: bool | None = None
    name: str | None = None
    expiration_date: None | datetime = None
    role: str | None = None
    is_superuser: bool | None = None


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


class UserAppsComplete(BaseModel):
    shared: dict[UUID, UserAppReturn]
    owned: dict[UUID, UserAppReturn]


class EntitlementPost(BaseModel):
    model_config = main_config
    tier: Literal["full", "basic"]


class EntitlementPut(EntitlementPost): ...  # type: ignore


class EntitlementPatch(EntitlementBase): ...  # type: ignore


class ValidateAndSync(BaseModel):
    model_config = main_config
    feature_entitlements: EntitlementGet


class SharedDashboardViewed(BaseModel):
    dashboard_uuid: UUID
    viewed: bool


class SharedAppViewed(BaseModel):
    app_uuid: UUID
    viewed: bool


class AuthData(BaseModel):
    model_config = main_config

    token: str | None = None
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


class GetRoleWithUsers(BaseModel):
    model_config = main_config
    uuid: UUID
    name: str
    description: str
    updated_date: datetime
    users: list[EmailStr]


class PostRole(BaseModel):
    model_config = main_config
    uuid: UUID | None = None
    name: str
    description: str
    users: list[EmailStr] | None = None


class PatchRole(BaseModel):
    model_config = main_config
    name: str | None = None
    description: str | None = None
    users: list[EmailStr] | None = None


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
    access_token: str
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
    feature_entitlements: EntitlementGet | None = None
    usage: EntitlementUsageGet | None = None
    custom_copilots: list[CustomCopilot] | None = None
    mcp_servers: list[MCPServer] | None = None
    is_first_login: bool | None = False
