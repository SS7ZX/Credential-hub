export type ResendSubmission = {
  accepted: boolean;
  providerId: string | null;
  detail?: string;
};

export async function submitResendEmail(
  apiKey: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<ResendSubmission> {
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let providerResponse: { id?: string; message?: string } = {};
    if (responseText) {
      try {
        providerResponse = JSON.parse(responseText) as typeof providerResponse;
      } catch {
        providerResponse = { message: "Email provider returned an unreadable response" };
      }
    }

    return response.ok
      ? { accepted: true, providerId: providerResponse.id ?? null }
      : {
        accepted: false,
        providerId: providerResponse.id ?? null,
        detail: providerResponse.message ?? "Email provider rejected the request",
      };
  } catch {
    return {
      accepted: false,
      providerId: null,
      detail: "Email provider request failed",
    };
  }
}
