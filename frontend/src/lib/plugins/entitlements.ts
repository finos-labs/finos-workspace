/**
 * Decides whether the current user may use a plugin. The POC allows every
 * plugin; a real implementation will call the BrightQuery entitlement API.
 */
export interface EntitlementService {
  hasAccess(pluginId: string): Promise<boolean>;
}

export const allowAllEntitlements: EntitlementService = {
  hasAccess: async () => true,
};
