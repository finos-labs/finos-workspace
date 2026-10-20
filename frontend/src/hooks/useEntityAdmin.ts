import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getEntities,
  getEntityMaps,
  getEntityRelationships,
  getEntityUsers,
  validateEntityAdmin,
} from "~/api/entities.api";

const ROOT = ["admin", "entityAdmin"] as const;

export const entityAdminKeys = {
  root: ROOT,
  validate: [...ROOT, "validate"] as const,
  entities: [...ROOT, "entities"] as const,
  relationships: [...ROOT, "relationships"] as const,
  maps: [...ROOT, "maps"] as const,
  users: [...ROOT, "users"] as const,
};

const STALE_TIME = 1000 * 60;

/**
 * Whether the signed-in user is a superuser, who manages entities. Anyone else is refused
 * by the backend, so a failed probe means no.
 */
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

export const useEntityRelationships = () =>
  useQuery({
    queryKey: entityAdminKeys.relationships,
    queryFn: getEntityRelationships,
    staleTime: STALE_TIME,
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
