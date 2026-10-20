import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { useUploadDocuments } from "~/components/AI/hooks/useUploadDocuments";
import { getDefaultCopilot } from "~/lib/constants";
import { useAuthStore } from "~/lib/state/auth";
import { type Copilot, useCopilotStore } from "~/lib/state/copilot";
import { useThemeStore } from "~/lib/state/theme";
import { makeAuthUser } from "../../../factories";
import { partial } from "../../../mocks";

const customAgent = partial<Copilot>({
  id: "custom-agent",
  holderUuid: "holder-1",
  endpoints: {
    query: "https://agent.test/query",
    upload_docs: "https://agent.test/upload",
  },
});

const uploaded = [
  {
    original_file_name: "notes.txt",
    stored_file_uuid: "file-1",
    extension: "txt",
    url: "https://files.test/file-1",
  },
];

function renderUpload() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUploadDocuments(), { wrapper }).result;
}

const file = () => new File(["hello"], "notes.txt", { type: "text/plain" });

describe("useUploadDocuments", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeAuthUser() });
    // No AI descriptions: only the upload itself is under test
    useThemeStore.setState({ aiEnhancements: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(uploaded), { status: 200 })),
    );
    vi.mocked(apiClient.post).mockResolvedValue({ data: uploaded });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    useCopilotStore.setState({ externalCopilotHolders: [] });
  });

  it("uploads the default Copilot's documents to the Workspace API", async () => {
    useCopilotStore.setState({ selectedCopilot: getDefaultCopilot() });
    const upload = renderUpload();

    await act(() => upload.current([file()]));

    expect(apiClient.post).toHaveBeenCalledWith("app/files", expect.any(FormData), {
      headers: { "content-type": "multipart/form-data" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a custom agent only its own headers, never a Workspace credential", async () => {
    useCopilotStore.setState({
      selectedCopilot: customAgent,
      externalCopilotHolders: [
        {
          uuid: "holder-1",
          url: "https://agent.test",
          headers: { "X-Agent-Key": "agent-key" },
        },
      ],
    });
    const upload = renderUpload();

    await act(() => upload.current([file()]));

    expect(apiClient.post).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://agent.test/upload");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Agent-Key")).toBe("agent-key");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Workspace-Client")).toBeNull();
    // The browser sets the multipart content type with its boundary
    expect(headers.get("Content-Type")).toBeNull();
    expect(init.credentials).toBeUndefined();
  });
});
