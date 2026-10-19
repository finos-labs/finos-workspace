/**
 * The Workspace's own tools, as a request carries them.
 *
 * The Workspace gives the agent in its web app the tools it has for itself (reading a widget, adding or
 * changing one, editing the tabs, navigating...) with the tools of the MCP servers the user connected: each is
 * a tool of a request, with the name, the description and the schema the Workspace gives it, and a call is
 * made like a call of any MCP tool (`execute_agent_tool`). The Workspace's tab runs it, as the signed-in user.
 * They are told from the others by the id of their server, which is the one the web app gives them
 * (`WORKSPACE_SERVER_ID` in the web app's `lib/state/workspaceTools.ts`).
 */
export const WORKSPACE_SERVER_ID = "workspace";
