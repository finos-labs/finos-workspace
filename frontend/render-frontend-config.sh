#!/bin/sh
# Writes config.js, which sets window.__APP_CONFIG__ before the app bundle
# loads, from environment variables each time the container starts.
#
# Each line of FIELDS maps one RuntimeConfigSchema field
# (src/lib/runtimeConfigSchema.ts) to an environment variable and a type. A
# field whose variable is unset is left out, so the schema default applies.
# The image build runs scripts/check-runtime-config.ts, which fails when this
# table and the schema disagree.
set -eu
set -f

out="${APP_CONFIG_PATH:-/usr/share/nginx/html/config.js}"
me=$(basename "$0")

FIELDS='
urls backend BACKEND_URL string
urls ai AI_API_URL string
authentication allowEmailLogin AUTHENTICATION_ALLOW_EMAIL_LOGIN bool
authentication identityProviders AUTHENTICATION_IDENTITY_PROVIDERS list
authentication sendMicrosoftIdToken AUTHENTICATION_SEND_MICROSOFT_IDTOKEN bool
authentication sendOktaIdToken AUTHENTICATION_SEND_OKTA_IDTOKEN bool
authentication sendUserEmailAsHeader AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER bool
authProviders googleClientId GOOGLE_OAUTH_CLIENT_ID string
authProviders azureClientId AZURE_CLIENT_ID string
authProviders azureTenantId AZURE_TENANT_ID string
authProviders oktaClientId OKTA_CLIENT_ID string
authProviders oktaDomain OKTA_DOMAIN string
copilot enabled AI_COPILOT_ENABLED bool
copilot defaultCopilot AI_COPILOT_DEFAULT_COPILOT bool
copilot documentationLinks AI_COPILOT_DOCUMENTATION_LINKS bool
copilot webSearch AI_COPILOT_WEB_SEARCH bool
copilot secFilings AI_COPILOT_SEC_FILINGS bool
copilot jinaAi AI_COPILOT_JINA_AI bool
copilot aiEnhancements AI_COPILOT_AI_ENHANCEMENTS bool
copilot saveSkillFromChat AI_COPILOT_SAVE_SKILL_FROM_CHAT bool
copilot showCustomKey AI_SHOW_CUSTOM_COPILOT_KEY bool
ui showCompanionMode UI_SHOW_COMPANION_MCP_MODE bool
ui showMinimizeWidget UI_SHOW_MINIMIZE_WIDGET bool
ui showExternalDocLinks UI_SHOW_EXTERNAL_DOCUMENTATION_LINKS bool
ui showHelpDocumentation UI_SHOW_HELP_DOCUMENTATION bool
ui showChangelog UI_SHOW_CHANGELOG bool
ui showCopilotSwitcher UI_SHOW_COPILOT_SWITCHER bool
ui showRemoveFromOrg UI_SHOW_REMOVE_FROM_ORG bool
ui defaultTheme UI_DEFAULT_THEME theme
data allowHtmlJsExecution ALLOW_HTML_JS_EXECUTION bool
links docsUrl DOCS_URL string
contact supportEmail SUPPORT_EMAIL string
whiteLabel name WL_NAME string
whiteLabel shortName WL_SHORT_NAME string
whiteLabel loginImage WL_LOGIN_IMAGE string
whiteLabel loginImageDark WL_LOGIN_IMAGE_DARK string
whiteLabel leftSidebarLogo WL_LEFT_SIDEBAR_LOGO string
whiteLabel leftSidebarLogoDark WL_LEFT_SIDEBAR_LOGO_DARK string
whiteLabel favicon WL_FAVICON string
whiteLabel description WL_DESCRIPTION string
whiteLabel keywords WL_KEYWORDS string
whiteLabel mainColor WL_MAIN_COLOR string
whiteLabel fontFamily WL_FONT_FAMILY string
whiteLabel showFloatingThemePreview WL_SHOW_FLOATING_THEME_PREVIEW bool
'

fail() {
  echo "$me: $*" >&2
  exit 1
}

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

# Comma-separated values, trimmed and lowercased the same way the schema
# coerces a comma-separated string.
json_list() {
  list=''
  IFS=,
  for item in $1; do
    item=$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [ -n "$item" ]; then
      list="$list${list:+, }$(json_string "$item")"
    fi
  done
  printf '[%s]' "$list"
}

render() {
  group_open=''
  sep=''
  printf 'window.__APP_CONFIG__ = {'
  while read -r group field var type; do
    [ -n "$group" ] || continue
    if [ "$group" != "$group_open" ]; then
      [ -z "$group_open" ] || printf '\n  },'
      printf '\n  "%s": {' "$group"
      group_open=$group
      sep=''
    fi
    eval "is_set=\${$var+set}"
    [ -n "$is_set" ] || continue
    eval "value=\$$var"
    case $type in
      string) json=$(json_string "$value") ;;
      list) json=$(json_list "$value") ;;
      bool)
        case $value in
          true | false) json=$value ;;
          *) fail "$var must be true or false" ;;
        esac
        ;;
      theme)
        case $value in
          light | dark) json="\"$value\"" ;;
          *) fail "$var must be light or dark" ;;
        esac
        ;;
      *) fail "unknown type $type for $var" ;;
    esac
    printf '%s\n    "%s": %s' "$sep" "$field" "$json"
    sep=','
  done <<EOF
$FIELDS
EOF
  printf '\n  }\n};'
}

config=$(render)
printf '%s\n' "$config" > "$out"
echo "$me: wrote $out"
