export interface OwnerIdentity {
  email: string | null;
  emailConfirmedAt: string | null;
}

export function isVerifiedAllowlistedOwner(
  identity: OwnerIdentity,
  allowedEmail: string,
): boolean {
  const email = identity.email?.trim().toLowerCase();
  const normalizedAllowedEmail = allowedEmail.trim().toLowerCase();
  return Boolean(
    identity.emailConfirmedAt &&
      email &&
      normalizedAllowedEmail &&
      email === normalizedAllowedEmail,
  );
}
