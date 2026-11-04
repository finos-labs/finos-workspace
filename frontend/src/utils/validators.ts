export function validateEmail(email: string): boolean {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return typeof email === "string" && re.test(email);
}

export const MAX_FOLDER_NAME_LENGTH = 20;
export const RESERVED_FOLDER_NAMES = ["root", "New folder"];

export function validateFolderName(folderName: string): boolean {
  return (
    Boolean(folderName) &&
    !RESERVED_FOLDER_NAMES.includes(folderName) &&
    folderName.length <= MAX_FOLDER_NAME_LENGTH
  );
}
