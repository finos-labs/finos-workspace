import { type MouseEvent, useMemo, useRef } from "react";
import { FooterLink, UploadedFile } from "~/components/General/UploadedFile";
import { useCallbackRef } from "~/hooks/useRefHooks";
import { COPILOT_ACCEPTED_EXTENSIONS } from "~/lib/constants";
import { useCopilotContext } from "~/lib/contexts/CopilotChatContext";
import { canAddConnections, useShallowAccessStore } from "~/lib/state/access";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { cn, extractUrlsFromText } from "~/lib/utils";
import { Button } from "../ds/atoms/Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import CopilotSwitcher from "./CopilotSwitcher";
import { useDictation } from "./hooks/useDictation";
import { useEnhancePrompt } from "./hooks/useEnhancePrompt";
import {
  StreamingStatus,
  useLocalCommand,
  useShallowStreamingStore,
} from "./hooks/useStreaming";
import { dispatchCopilotCommand } from "./hooks/utils";
import ModelPicker from "./ModelPicker";
import PromptSuggestions from "./PromptSuggestions";
import TextArea from "./TextArea";

export default function CopilotFooter() {
  const mayUpload = useShallowAccessStore((s) => canAddConnections(s.access));
  const fileUploadFF = useShallowCopilotStore(
    (s) =>
      Boolean(s.selectedCopilot?.features?.["file-upload"]) &&
      (mayUpload || s.selectedCopilot?.id !== "default-copilot"),
  );

  const handleSubmitRef = useCopilotContext().handleSubmitRef;
  const { limitReached, loading, files, dispatch } = useShallowStreamingStore((s) => ({
    limitReached: s.limitReached,
    loading: s.loading,
    files: s.files,
    dispatch: s.dispatch,
  }));

  const prompt = useLocalCommand();
  const { enhancePrompt, isEnhancing } = useEnhancePrompt();

  const isPromptEmpty = useMemo(() => prompt.trim().length === 0, [prompt]);

  const hasPendingFiles = useMemo(
    () => files.some((file) => file.status === "pending"),
    [files],
  );

  const selectedCopilot = useShallowCopilotStore((s) => s.selectedCopilot);
  const speechToTextFF = Boolean(selectedCopilot?.features?.["speech-to-text"]);
  const onDictated = useCallbackRef((text: string) =>
    dispatchCopilotCommand((prev) =>
      prev.trim() ? `${prev.trimEnd()} ${text}` : text,
    ),
  );
  const dictation = useDictation(selectedCopilot, onDictated);
  const recording = dictation.state === "recording";
  const transcribing = dictation.state === "transcribing";
  const inputRef = useRef<HTMLDivElement | null>(null);

  const uniqueLinks = useMemo(() => {
    const urls = extractUrlsFromText(prompt);
    return [...new Set(urls)];
  }, [prompt]);

  const thumbs = useMemo(() => {
    if (files.length === 0) return null;
    return files.map((file) => (
      <UploadedFile
        key={file.name}
        name={file.name}
        status={file.status}
        onClick={() => {
          dispatch({
            files: (prev) => prev.filter((f) => f.name !== file.name),
          });
        }}
        className="max-w-64 shrink-0"
      />
    ));
  }, [files, dispatch]);

  const thumbsLinks = useMemo(() => {
    if (uniqueLinks.length === 0) return null;
    return uniqueLinks.map((link) => <FooterLink key={link} link={link} />);
  }, [uniqueLinks]);

  const fileLinksFooterMemo = useMemo(() => {
    return (
      (thumbs || thumbsLinks) && (
        <aside className="flex gap-2 mx-2 overflow-x-auto items-center">
          {thumbs}
          {thumbsLinks}
        </aside>
      )
    );
  }, [thumbs, thumbsLinks]);

  const promptSuggestionsMemo = useMemo(
    () => (
      <PromptSuggestions setCompletion={(completion) => dispatch({ completion })} />
    ),
    [dispatch],
  );

  const onSendClick = useCallbackRef((e: MouseEvent) => {
    e.preventDefault();
    if (isPromptEmpty && !loading) return;
    if (hasPendingFiles && !loading) return;
    if (loading) dispatch(StreamingStatus.STOPPED);

    handleSubmitRef.current?.({ question: prompt });
  });

  const onEnhanceClick = useCallbackRef(async (e: MouseEvent) => {
    e.preventDefault();
    if (loading || limitReached || isEnhancing) return;

    try {
      const enhancedText = await enhancePrompt(prompt);
      dispatchCopilotCommand(enhancedText);
    } catch (error) {
      console.error("Failed to enhance prompt:", error);
    }
  });

  const buttonsMemo = useMemo(
    () => (
      <>
        <div className="flex p-1 items-center justify-end">
          <div className="flex gap-2 items-center w-full">
            <CopilotSwitcher />
            <ModelPicker />
            <div className="flex shrink-0 gap-1 items-center">
              {promptSuggestionsMemo}
              {speechToTextFF && (
                <Tooltip message={recording ? "Stop voice input" : "Start voice input"}>
                  <div className="tooltip-wrapper">
                    <button
                      type="button"
                      aria-label={recording ? "Stop voice input" : "Start voice input"}
                      aria-pressed={recording}
                      onClick={() =>
                        recording ? dictation.stop() : void dictation.start()
                      }
                      disabled={loading || limitReached || transcribing}
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded transition-colors duration-200 min-w-8",
                        {
                          "opacity-25 cursor-default":
                            loading || limitReached || transcribing,
                          "text-ds-text-body hover:bg-btn-ghost-bg-hover":
                            !loading && !limitReached && !transcribing,
                          "bg-brand-main/10": recording,
                        },
                      )}
                    >
                      <Icon
                        id={
                          transcribing
                            ? "mdi-loading"
                            : recording
                              ? "ph-microphone-slash-fill"
                              : "ph-microphone-fill"
                        }
                        className={cn("h-4 w-4 stroke-1", {
                          "animate-spin": transcribing,
                          "animate-pulse text-brand-main dark:text-brand-lighter":
                            recording,
                        })}
                      />
                    </button>
                  </div>
                </Tooltip>
              )}

              <Tooltip
                message={
                  fileUploadFF
                    ? `Attach files (${COPILOT_ACCEPTED_EXTENSIONS.filter(
                        (e) => e !== ".markdown",
                      )
                        .map((e) => e.slice(1).toUpperCase())
                        .join(", ")} supported)`
                    : "File upload is not enabled for this agent."
                }
              >
                <div className="tooltip-wrapper">
                  <button
                    type="button"
                    aria-label="Attach files"
                    onClick={() => document.getElementById("file-upload")?.click()}
                    disabled={!fileUploadFF || loading || limitReached}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded transition-colors duration-200 min-w-8",
                      {
                        "opacity-25 cursor-default":
                          !fileUploadFF || loading || limitReached,
                        "text-ds-text-body hover:bg-btn-ghost-bg-hover":
                          fileUploadFF && !loading && !limitReached,
                      },
                    )}
                  >
                    <Icon id="attachment-icon" className="h-4 w-4 stroke-1" />
                  </button>
                </div>
              </Tooltip>
              <Tooltip
                message={isPromptEmpty ? "Generate prompt" : "Prompt enhancement"}
              >
                <div className="tooltip-wrapper">
                  <button
                    type="button"
                    aria-label={
                      isPromptEmpty ? "Generate prompt" : "Prompt enhancement"
                    }
                    onClick={onEnhanceClick}
                    disabled={loading || limitReached || isEnhancing}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded transition-colors duration-200 min-w-8",
                      {
                        "opacity-25 cursor-default":
                          loading || limitReached || isEnhancing,
                        "text-ds-text-body hover:bg-btn-ghost-bg-hover":
                          !loading && !limitReached && !isEnhancing,
                      },
                    )}
                  >
                    <Icon
                      id={isEnhancing ? "mdi-loading" : "sparkles-icon"}
                      className={cn("h-4 w-4 stroke-1", {
                        "animate-spin": isEnhancing,
                      })}
                    />
                  </button>
                </div>
              </Tooltip>

              <Button
                id="send-copilot-message"
                icon={true}
                size="sm"
                onClick={onSendClick}
                disabled={
                  limitReached || ((isPromptEmpty || hasPendingFiles) && !loading)
                }
                variant="primary"
              >
                {loading ? (
                  <Icon id="lucide-stop-circle" className="h-4 w-4" />
                ) : (
                  <Icon id="send" className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </>
    ),
    [
      onSendClick,
      onEnhanceClick,
      dictation,
      limitReached,
      loading,
      fileUploadFF,
      isPromptEmpty,
      hasPendingFiles,
      isEnhancing,
      speechToTextFF,
      recording,
      transcribing,
      promptSuggestionsMemo,
    ],
  );

  const textAreaMemo = useMemo(() => <TextArea type="footer" />, []);

  return useMemo(
    () => (
      <>
        <div
          id="copilot-chat-footer"
          ref={inputRef}
          className="mt-auto rounded-b border-b border-l border-r border-general-border-primary bg-general-bg-primary p-1"
        >
          <div className="flex flex-col gap-2 w-full notranslate">
            <div
              className={cn(
                "mx-2 mt-1 bg-transparent relative w-[calc(100%-1rem)] min-h-[75px]",
                {
                  "opacity-50": limitReached,
                },
              )}
            >
              <div className="relative">{textAreaMemo}</div>
            </div>
            {fileLinksFooterMemo}
            {buttonsMemo}
          </div>
        </div>
      </>
    ),
    [limitReached, textAreaMemo, buttonsMemo, fileLinksFooterMemo],
  );
}
