let current = "";

export function getUserEmail(): string {
  return current;
}

export function setUserEmail(email: string) {
  current = email;
}

export function clearUserEmail() {
  current = "";
}
