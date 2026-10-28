import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useGetCopilotRequestHeaders } from "~/components/AI/hooks/useGetCopilotRequestHeaders";
import { getDefaultCopilot } from "~/lib/constants";
import { type Copilot, useCopilotStore } from "~/lib/state/copilot";
import { clearIdpTokens, setIdpTokens } from "~/lib/state/idpTokens";
import { mockConfig } from "../../../../mocks/runtimeConfig";
import { partial } from "../../../mocks";

const customAgent = partial<Copilot>({ id: "custom-agent", holderUuid: "holder-1" });
const holderHeaders = { "X-Agent-Key": "agent-key" };

function getHeaders(agent?: Copilot) {
  const { result } = renderHook(() => useGetCopilotRequestHeaders());
  return result.current("trace-1", agent);
}

describe("useGetCopilotRequestHeaders", () => {
  afterEach(() => {
    clearIdpTokens();
    mockConfig.authentication.sendUserEmailAsHeader = false;
    useCopilotStore.setState({ externalCopilotHolders: [] });
  });

  it("adds no FINOS Workspace credential and no user id for the default Copilot", () => {
    setIdpTokens({ email: "user@example.com" });

    expect(getHeaders(getDefaultCopilot())).toEqual({
      "Content-Type": "application/json",
      "X-Trace-Id": "trace-1",
    });
  });

  it("sends a custom agent its own headers, looked up by its holder", () => {
    useCopilotStore.setState({
      externalCopilotHolders: [
        { uuid: "holder-1", url: "https://agent.test", headers: holderHeaders },
      ],
    });

    expect(getHeaders(customAgent)).toEqual({
      "X-Agent-Key": "agent-key",
      "Content-Type": "application/json",
      "X-Trace-Id": "trace-1",
    });
  });

  it("adds the identity headers the deployment forwards without saving them", () => {
    mockConfig.authentication.sendUserEmailAsHeader = true;
    setIdpTokens({ email: "user@example.com" });
    useCopilotStore.setState({
      externalCopilotHolders: [
        { uuid: "holder-1", url: "https://agent.test", headers: holderHeaders },
      ],
    });

    expect(getHeaders(customAgent)).toMatchObject({
      "X-Agent-Key": "agent-key",
      "X-Workspace-User": "user@example.com",
    });
    expect(useCopilotStore.getState().externalCopilotHolders[0].headers).toEqual({
      "X-Agent-Key": "agent-key",
    });
  });
});
