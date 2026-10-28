/**
 * A tool of the FINOS Workspace, called by the agent, is run by this tab: the FINOS Workspace checks the call and says
 * what command it is, the tab runs the command, and the agent is handed what it came to.
 */

import { renderHook } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareWorkspaceToolCall } from "~/api/workspaceTools.api";
import { useWorkspaceToolExecutor } from "~/components/AI/hooks/useWorkspaceToolExecutor";

const runCommand = vi.hoisted(() => vi.fn());

vi.mock("~/api/workspaceTools.api", () => ({
  prepareWorkspaceToolCall: vi.fn(),
}));
vi.mock("~/components/AI/hooks/useWorkspaceBridgeCommandHandler", () => ({
  useWorkspaceBridgeCommandHandler: () => runCommand,
}));

const run = (toolName: string, parameters?: Record<string, unknown>) => {
  const { result } = renderHook(() => useWorkspaceToolExecutor());
  return result.current(toolName, parameters);
};

/** What the agent is handed: the text of the one item of the result. */
const resultOf = async (call: ReturnType<typeof run>) => {
  const data = await call;
  expect(data).toHaveLength(1);
  expect(data[0].items).toHaveLength(1);
  return JSON.parse((data[0].items[0] as { content: string }).content);
};

beforeEach(() => {
  vi.mocked(prepareWorkspaceToolCall).mockReset();
  runCommand.mockReset();
});

describe("running a tool of the FINOS Workspace", () => {
  it("runs the command the FINOS Workspace says the call is, and hands the agent what it came to", async () => {
    const command = { command: "get_widget_data", request_id: null, data_sources: [] };
    const outcome = {
      ok: true,
      command: "get_widget_data",
      message: "done",
      data: [1],
    };
    vi.mocked(prepareWorkspaceToolCall).mockResolvedValue({ command, result: null });
    runCommand.mockResolvedValue(outcome);

    const result = await resultOf(
      run("Workspace_get_widget_data", { origin: "Options", widget_id: "chain" }),
    );

    expect(prepareWorkspaceToolCall).toHaveBeenCalledWith("get_widget_data", {
      origin: "Options",
      widget_id: "chain",
    });
    expect(runCommand).toHaveBeenCalledWith(command);
    expect(result).toEqual(outcome);
  });

  it("asks about a tool by its name on the FINOS Workspace's server", async () => {
    vi.mocked(prepareWorkspaceToolCall).mockResolvedValue({
      command: { command: "read_widget" },
      result: null,
    });
    runCommand.mockResolvedValue({ ok: true, command: "read_widget", message: "" });

    await run("Workspace_read_widget");

    expect(prepareWorkspaceToolCall).toHaveBeenCalledWith("read_widget", {});
  });

  it("hands the agent the FINOS Workspace's answer, and runs nothing, for a call that is not valid", async () => {
    const answer = {
      ok: false,
      command: "read_widget",
      message: "read_widget requires widget_uuid",
      error: { code: "invalid_request", message: "read_widget requires widget_uuid" },
    };
    vi.mocked(prepareWorkspaceToolCall).mockResolvedValue({
      command: null,
      result: answer,
    });

    expect(await resultOf(run("Workspace_read_widget", {}))).toEqual(answer);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("says why when the FINOS Workspace refuses the call, and runs nothing", async () => {
    vi.mocked(prepareWorkspaceToolCall).mockRejectedValue(
      new AxiosError(
        "Request failed with status code 403",
        "ERR_BAD_REQUEST",
        undefined,
        undefined,
        {
          status: 403,
          data: { detail: "You do not have access to the tool `delete_widget`" },
        } as AxiosResponse,
      ),
    );

    const result = await resultOf(run("Workspace_delete_widget", { widget_uuid: "w" }));

    expect(result).toMatchObject({
      ok: false,
      command: "delete_widget",
      message: "You do not have access to the tool `delete_widget`",
      error: { code: "command_failed" },
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("says what went wrong when the FINOS Workspace cannot be asked", async () => {
    vi.mocked(prepareWorkspaceToolCall).mockRejectedValue(new Error("Network Error"));

    const result = await resultOf(run("Workspace_read_widget", { widget_uuid: "w" }));

    expect(result).toMatchObject({
      ok: false,
      command: "read_widget",
      message: "Network Error",
    });
  });

  it("hands the agent the failure when the tab cannot run the command", async () => {
    vi.mocked(prepareWorkspaceToolCall).mockResolvedValue({
      command: { command: "read_widget" },
      result: null,
    });
    runCommand.mockRejectedValue(new Error("the dashboard is gone"));

    const result = await resultOf(run("Workspace_read_widget", { widget_uuid: "w" }));

    expect(result).toMatchObject({ ok: false, message: "the dashboard is gone" });
  });
});
