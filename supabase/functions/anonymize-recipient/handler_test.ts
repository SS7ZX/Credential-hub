import {
  createAnonymizeRecipientHandler,
  type AnonymizationHandlerDependencies,
} from "./handler.ts";

const recipientId = "61000000-0000-4000-8000-000000000001";

function testHandler(role: string | null) {
  let anonymizeCalls = 0;
  const dependencies: AnonymizationHandlerDependencies = {
    authenticate: async () => {
      if (!role) throw new Error("Authentication required");
      return { userId: "test-user" };
    },
    getRecipientContext: async () => ({
      organizationId: "21000000-0000-0000-0000-000000000001",
      async anonymize() {
        anonymizeCalls += 1;
      },
    }),
    requireOrganizationRole: async (_request, _organizationId, allowedRoles) => {
      if (!role || !allowedRoles.includes(role)) {
        throw new Error("Insufficient organization role");
      }
    },
  };
  return {
    handler: createAnonymizeRecipientHandler(dependencies),
    anonymizeCalls: () => anonymizeCalls,
  };
}

function request(): Request {
  return new Request("http://local.test/functions/v1/anonymize-recipient", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipientId }),
  });
}

Deno.test("anonymization handler allows owner and admin", async () => {
  for (const role of ["owner", "admin"]) {
    const test = testHandler(role);
    const response = await test.handler(request());
    if (response.status !== 200 || test.anonymizeCalls() !== 1) {
      throw new Error(
        `${role} should be allowed to anonymize; got ${response.status}: ${await response.text()}`,
      );
    }
  }
});

Deno.test("anonymization handler denies issuer and viewer", async () => {
  for (const role of ["issuer", "viewer"]) {
    const test = testHandler(role);
    const response = await test.handler(request());
    if (response.status !== 403 || test.anonymizeCalls() !== 0) {
      throw new Error(
        `${role} should be denied before anonymization; got ${response.status}: ${await response.text()}`,
      );
    }
  }
});

Deno.test("anonymization handler returns 401 when unauthenticated", async () => {
  const test = testHandler(null);
  const response = await test.handler(request());
  if (response.status !== 401 || test.anonymizeCalls() !== 0) {
    throw new Error(
      `Unauthenticated request should be rejected; got ${response.status}: ${await response.text()}`,
    );
  }
});
