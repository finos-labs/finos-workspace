import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useUserResourcePermissions } from "~/hooks/useUserResourcePermissions";

type SharedPrompt = {
  uuid: string;
  access: string;
  prompt: string;
  tooltip?: string;
  createdAt?: string;
};

export default function useSharedPrompts(isSharedResource = false) {
  const { data, refetch, error, isLoading, ...rest } = useUserResourcePermissions({
    enabled: isSharedResource,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (rest.isFetching) return;
    if (isSharedResource && rest.isStale) refetch();
  }, [isSharedResource]);

  const sharedPrompts = useMemo((): SharedPrompt[] => {
    if (!data) return [];
    const { backends = [], prompts = [] } = data;

    const standalonePrompts = prompts.map((p) => ({
      uuid: p.uuid,
      access: p.access,
      prompt: p.prompt.prompt,
      tooltip: undefined,
      createdAt: p.prompt.createdAt,
    }));

    const templatePrompts = backends.flatMap((backend) =>
      backend.templates.flatMap((template) =>
        (template.prompts ?? []).map((p) => ({
          uuid: `${backend.uuid}:${template.templateId}:${p.promptId}`,
          access: p.access,
          prompt: p.promptId,
          tooltip: `${backend.name} > ${template.templateId} > ${p.promptId}`,
        })),
      ),
    );

    return [...standalonePrompts, ...templatePrompts];
  }, [data]);

  return {
    sharedPrompts,
    isLoading,
    error,
  };
}
