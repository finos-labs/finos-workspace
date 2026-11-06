LOCAL_DEV_ADMINS: tuple[tuple[str, str, str, str], ...] = (
    ("workspace-dev1@localhost.local", "Workspace", "Dev 1", "WorkspaceDev!1"),
    ("workspace-dev2@localhost.local", "Workspace", "Dev 2", "WorkspaceDev!2"),
    ("workspace-dev3@localhost.local", "Workspace", "Dev 3", "WorkspaceDev!3"),
)


LOCAL_DEV_ADMIN_PASSWORDS: dict[str, str] = {
    email: password for email, _first, _last, password in LOCAL_DEV_ADMINS
}
