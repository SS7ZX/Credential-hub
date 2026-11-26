declare const __PUBLIC_SITE_URL__: string | undefined

export const brand = {
  productName: 'CredentialHub',
  shortName: 'CH',
} as const

export function getPublicSiteUrl(): string {
  return __PUBLIC_SITE_URL__ ? new URL(__PUBLIC_SITE_URL__).origin : window.location.origin
}
