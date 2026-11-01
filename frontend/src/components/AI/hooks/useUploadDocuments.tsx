import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "~/api/api";
import type { PostUploadFileResponse } from "~/api/auth.api";
import { AI_SUPPORTED_FILE_TYPES } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import { fetchAgent } from "~/lib/state/agentToken";
import { useShallowAuthStore } from "~/lib/state/auth";
import { type CopilotFile, useShallowCopilotStore } from "~/lib/state/copilot";
import { useShallowThemeStore } from "~/lib/state/theme";
import { useGetCopilotRequestHeaders } from "./useGetCopilotRequestHeaders";
import { useShallowStreamingStore } from "./useStreaming";

const MEGABYTE = 1024 * 1024;

export function updateFileStatus<T extends CopilotFile>(
  prevFiles: T[],
  filesToUpload: File[],
): T[] {
  return prevFiles.map((file) => ({
    ...file,
    status: filesToUpload.some(
      (f) => f.name === file.name && file.status !== "uploaded",
    )
      ? "failed"
      : file.status,
  }));
}

const aiCopilotAiEnhancementsFF =
  getConfig().copilot.enabled && getConfig().copilot.aiEnhancements;

async function getDescriptionsMap(
  uploadedFiles: PostUploadFileResponse,
  files: File[],
  aiEnhancements = false,
): Promise<Map<string, { name: string; description: string }>> {
  const descriptionsMap = new Map<string, { name: string; description: string }>();
  await Promise.all(
    uploadedFiles.map(async (uploadedFile) => {
      if (
        AI_SUPPORTED_FILE_TYPES.some((type) => type === uploadedFile.extension) &&
        !uploadedFile.failed
      ) {
        const file = files.find((f) => f.name === uploadedFile.original_file_name);
        const fileInfo = {
          name: uploadedFile.original_file_name.replace(/\.[^/.]+$/, ""),
          description: uploadedFile.original_file_name,
        };

        if (file && aiEnhancements && aiCopilotAiEnhancementsFF) {
          const formData = new FormData();
          formData.append("file", file);
          try {
            const aiResponse = await fetchAgent(
              `${getConfig().urls.ai}/v1/generate/widget_info/file`,
              { method: "POST", body: formData },
            );
            if (aiResponse.ok) {
              const data = await aiResponse.json();
              fileInfo.name = data.title;
              fileInfo.description = data.description;
            }
          } catch (error) {
            console.error("Error fetching description for file:", file.name, error);
          }
        }
        descriptionsMap.set(uploadedFile.stored_file_uuid, fileInfo);
      }
    }),
  );
  return descriptionsMap;
}

async function uploadToAgent(
  formData: FormData,
  uploadUrl: string,
  toWorkspace: boolean,
  agentHeaders: Record<string, string>,
): Promise<PostUploadFileResponse> {
  if (toWorkspace) {
    const { data } = await apiClient.post<PostUploadFileResponse>(uploadUrl, formData, {
      headers: { "content-type": "multipart/form-data" },
    });
    return data;
  }

  const response = await fetchAgent(uploadUrl, {
    method: "POST",
    headers: agentHeaders,
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`The agent refused the upload (HTTP ${response.status}).`);
  }
  return await response.json();
}

export function useUploadDocuments() {
  const dispatch = useShallowStreamingStore((s) => s.dispatch);
  const signedIn = useShallowAuthStore((s) => s.user !== null);
  const selectedCopilot = useShallowCopilotStore((s) => s.selectedCopilot);
  const aiEnhancements = useShallowThemeStore((state) => state.aiEnhancements);
  const getCopilotRequestHeaders = useGetCopilotRequestHeaders();

  const { mutateAsync: uploadDocuments } = useMutation<void, Error, File[]>({
    mutationFn: async (filesToUpload: File[]) => {
      const { fileChunks } = filesToUpload.reduce(
        ({ fileChunks, chunkSize }, file) => {
          if (file.size > 25 * MEGABYTE) {
            dispatch({
              files: (prevFiles) => prevFiles.filter((f) => f.name !== file.name),
            });
            toast.error("Upload limit exceeded", {
              description: (
                <div className="grid gap-1">
                  <span>Individual files must be less than 25MB.</span>
                  <span>
                    <strong>{file.name}</strong> was not uploaded.
                  </span>
                </div>
              ),
            });

            return { fileChunks, chunkSize };
          }
          chunkSize += file.size;
          if (chunkSize > 150 * MEGABYTE) fileChunks.push([]);
          fileChunks[fileChunks.length - 1].push(file);
          return { fileChunks, chunkSize };
        },
        { fileChunks: [[] as File[]], chunkSize: 0 },
      );

      if (!(signedIn && selectedCopilot)) {
        throw new Error("Sign in and select an agent to upload documents.");
      }

      const toWorkspace = selectedCopilot.id === "default-copilot";
      const { "Content-Type": _json, ...agentHeaders } = getCopilotRequestHeaders();

      for (const files of fileChunks) {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file);
        }

        const uploadUrl = toWorkspace
          ? "app/files"
          : selectedCopilot.endpoints.upload_docs;
        if (!uploadUrl)
          throw new Error("The selected agent does not accept documents.");

        const uploadedFiles = await uploadToAgent(
          formData,
          uploadUrl,
          toWorkspace,
          agentHeaders,
        );

        if (uploadedFiles?.length) {
          const descriptionsMap = await getDescriptionsMap(
            uploadedFiles,
            files,
            aiEnhancements,
          );
          dispatch({
            files: (prevFiles) =>
              prevFiles.map((prevFile) => {
                const uploadedFile = uploadedFiles.find(
                  (file) => file.original_file_name === prevFile.name,
                );
                if (uploadedFile) {
                  const fileInfo = descriptionsMap.get(uploadedFile.stored_file_uuid);
                  return {
                    ...prevFile,
                    status: uploadedFile.failed ? "failed" : "uploaded",
                    stored_file_uuid: uploadedFile.stored_file_uuid,
                    url: uploadedFile.url,
                    description: fileInfo?.description ?? prevFile.description,
                    name: uploadedFile.original_file_name,
                  };
                }
                return prevFile;
              }),
          });

          continue;
        }
        return;
      }
    },

    onSuccess: (_response, filesToUpload) => {
      dispatch({
        files: (prevFiles) => updateFileStatus(prevFiles, filesToUpload),
      });
    },

    onError: (error, filesToUpload) => {
      console.error("Error uploading documents", error);
      dispatch({
        files: (prevFiles) => updateFileStatus(prevFiles, filesToUpload),
      });
    },
  });

  return uploadDocuments;
}
