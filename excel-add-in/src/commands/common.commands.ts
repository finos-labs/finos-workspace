import { logout as endServerSession } from "~/backend/auth.api";
import { useAuthStore } from "~/store/auth";

export function updateRibbon() {
  const { user } = useAuthStore.getState();
  const isLogged = !!user?.access_token;
  console.info("🎛️ Updating ribbon, token in storage?", isLogged);

  Office?.ribbon?.requestUpdate({
    tabs: [
      {
        id: "Workspace.Tab",
        groups: [
          {
            id: "Group3",
            controls: [
              {
                // This is the Account button
                // TODO: Change the id to Group3.ButtonAccount
                // Will cause a breaking change, the manifest and this change
                // must be deployed in sync
                id: "Group3.Button1",
                enabled: isLogged,
                
              },     
              {
                id: "Group3.ButtonSignIn",
                enabled: !isLogged,
              },
              {
                id: "Group3.ButtonSignOut",
                enabled: isLogged,
              },              
            ],
          },
        ],
      },
    ],
  });
}

/**
 * Signs the user out: ends the server session (POST /app/logout), then clears
 * the local one, which happens even when the server call fails.
 */
export async function signOutUser(): Promise<void> {
  try {
    await endServerSession();
  } catch (error) {
    console.error("Server sign-out failed; clearing the local session anyway.", error);
  }
  useAuthStore.getState().logout();
}

export async function signOut(event: Office.AddinCommands.Event) {
  await signOutUser();
  event.completed();
}

Office.actions.associate("signOut", signOut);
