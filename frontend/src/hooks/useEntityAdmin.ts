import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getEntities,
  getEntityMaps,
  getEntityUsers,
  getRemovedEntities,
  validateEntityAdmin,
} from "~/api/entities.api";

const ROOT = ["admin", "entityAdmin"] as const;

export const entityAdminKeys = {
  root: ROOT,
  validate: [...ROOT, "validate"] as const,
  entities: [...ROOT, "entities"] as const,
  removedEntities: [...ROOT, "removedEntities"] as const,
  maps: [...ROOT, "maps"] as const,
  users: [...ROOT, "users"] as const,
};

const STALE_TIME = 1000 * 60;

export function useIsEntityAdmin() {
  const { data, isLoading } = useQuery({
    queryKey: entityAdminKeys.validate,
    queryFn: validateEntityAdmin,
    staleTime: 1000 * 60 * 5,
    retry: false,
    notifyOnChangeProps: ["data", "isLoading"],
  });

  return useMemo(
    () => ({ isEntityAdmin: !!data?.success, isLoading }),
    [data, isLoading],
  );
}

export const useEntities = () =>
  useQuery({
    queryKey: entityAdminKeys.entities,
    queryFn: getEntities,
    staleTime: STALE_TIME,
  });

export const useRemovedEntities = (enabled: boolean) =>
  useQuery({
    queryKey: entityAdminKeys.removedEntities,
    queryFn: getRemovedEntities,
    staleTime: STALE_TIME,
    enabled,
  });

export const useEntityMaps = () =>
  useQuery({
    queryKey: entityAdminKeys.maps,
    queryFn: getEntityMaps,
    staleTime: STALE_TIME,
  });

export const useEntityUsers = () =>
  useQuery({
    queryKey: entityAdminKeys.users,
    queryFn: getEntityUsers,
    staleTime: STALE_TIME,
  });
