import { createClient } from "npm:@supabase/supabase-js@2";
import {
  removeStampedPdfsThen,
  STAMPED_PDF_BUCKET,
} from "../supabase/functions/_shared/anonymize-stamped-pdfs.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const inputPath = Deno.env.get("STAMP_TEST_OUTPUT");
if (!supabaseUrl || !anonKey || !serviceRoleKey || !inputPath) {
  throw new Error("Local Supabase credentials and STAMP_TEST_OUTPUT are required");
}

const credentialId = "70000000-0000-4000-8000-000000000001";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const signIn = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireResult<T>(
  data: T | null,
  error: unknown,
  operation: string,
): T {
  if (error || data === null) throw new Error(`Local integration failed: ${operation}`);
  return data;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pdfBytes = await Deno.readFile(inputPath);
const ownerEmail = `stamp-owner-${crypto.randomUUID()}@example.test`;
const ownerPassword = `Test-${crypto.randomUUID()}-A1!`;
const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
  email: ownerEmail,
  password: ownerPassword,
  email_confirm: true,
});
const owner = requireResult(createdUser?.user ?? null, createUserError, "create synthetic owner");

const { data: loginData, error: loginError } = await signIn.auth.signInWithPassword({
  email: ownerEmail,
  password: ownerPassword,
});
const accessToken = requireResult(
  loginData?.session?.access_token ?? null,
  loginError,
  "authenticate synthetic owner",
);
const ownerClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
});

const { data: organization, error: organizationError } = await admin
  .from("organizations")
  .insert({
    name: "Synthetic stamping integration",
    slug: `stamp-test-${crypto.randomUUID()}`,
    did: "did:web:example.test",
    created_by: owner.id,
  })
  .select("id")
  .single();
const organizationRow = requireResult(organization, organizationError, "create synthetic organization");
const organizationId = organizationRow.id;

const { error: memberError } = await admin.from("organization_members").insert({
  organization_id: organizationId,
  user_id: owner.id,
  role: "owner",
});
requireResult(true, memberError, "create synthetic owner membership");

const { data: event, error: eventError } = await admin
  .from("events")
  .insert({ organization_id: organizationId, name: "Synthetic stamping event" })
  .select("id")
  .single();
const eventRow = requireResult(event, eventError, "create synthetic event");

const { data: achievement, error: achievementError } = await admin
  .from("achievements")
  .insert({
    organization_id: organizationId,
    event_id: eventRow.id,
    name: "Synthetic stamping achievement",
    description: "Local integration test",
  })
  .select("id")
  .single();
const achievementRow = requireResult(achievement, achievementError, "create synthetic achievement");

const { data: recipient, error: recipientError } = await admin
  .from("recipients")
  .insert({
    organization_id: organizationId,
    full_name: "Synthetic Recipient QA",
    email: "synthetic-qa@example.test",
    email_hash: "synthetic-stamping-recipient-hash",
    salt: "synthetic-stamping-salt",
  })
  .select("id")
  .single();
const recipientRow = requireResult(recipient, recipientError, "create synthetic recipient");

const { error: statusListError } = await admin.from("status_lists").insert({
  organization_id: organizationId,
  revoked_credential_ids: [],
});
requireResult(true, statusListError, "create synthetic revocation list");

const { error: credentialError } = await admin.from("credentials").insert({
  id: credentialId,
  organization_id: organizationId,
  achievement_id: achievementRow.id,
  recipient_id: recipientRow.id,
  status: "issued",
  serial_number: `SAMPLE-${crypto.randomUUID()}`,
  issued_at: new Date().toISOString(),
  credential_json: {},
  jws: "synthetic-local-integration",
});
requireResult(true, credentialError, "create synthetic issued credential");

const { error: layoutError } = await ownerClient.rpc("save_qr_layout", {
  p_organization_id: organizationId,
  p_achievement_id: achievementRow.id,
  p_page_number: 1,
  p_x_points: 24,
  p_y_points: 24,
  p_size_points: 80,
  p_expected_page_width_points: 842,
  p_expected_page_height_points: 595,
  p_page_size_tolerance_points: 1,
});
requireResult(true, layoutError, "save synthetic QR layout");

const { data: runId, error: createRunError } = await ownerClient.rpc("create_stamp_run", {
  p_organization_id: organizationId,
  p_achievement_id: achievementRow.id,
  p_drive_folder_id: "syntheticDriveFolder0001",
  p_expected_file_count: 1,
  p_idempotency_key: "a".repeat(64),
});
const stampRunId = requireResult(runId, createRunError, "create synthetic stamp run");

const { data: fileId, error: registerFileError } = await ownerClient.rpc("register_stamp_file", {
  p_stamp_run_id: stampRunId,
  p_credential_id: credentialId,
  p_drive_file_id: "syntheticDriveFile0001",
});
const stampFileId = requireResult(fileId, registerFileError, "register synthetic stamp file");

const { error: approvalError } = await ownerClient.rpc("approve_stamp_run_review", {
  p_stamp_run_id: stampRunId,
  p_sampled_file_ids: [stampFileId],
  p_acknowledged: true,
});
requireResult(true, approvalError, "approve synthetic sample");

const { data: claim, error: claimError } = await ownerClient.rpc("claim_stamp_file", {
  p_stamp_file_id: stampFileId,
  p_source_sha256: await digest(pdfBytes),
});
const claimResult = requireResult(claim, claimError, "claim synthetic stamp file");
const storagePath = claimResult.storagePath;

const { error: uploadError } = await admin.storage
  .from(STAMPED_PDF_BUCKET)
  .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
requireResult(true, uploadError, "upload stamped PDF to local Storage");

const { error: completeStampError } = await ownerClient.rpc("complete_stamp_file", {
  p_stamp_file_id: stampFileId,
  p_success: true,
  p_output_sha256: await digest(pdfBytes),
  p_error_code: null,
});
requireResult(true, completeStampError, "complete synthetic stamp");

const { data: cleanupPlan, error: prepareError } = await admin.rpc(
  "prepare_recipient_anonymization",
  { p_actor_id: owner.id, p_recipient_id: recipientRow.id },
);
const cleanup = requireResult(cleanupPlan, prepareError, "prepare anonymization");
assert(
  Array.isArray(cleanup.storagePaths) && cleanup.storagePaths.includes(storagePath),
  "anonymization plan did not include the stamped object",
);

let storageFailureObserved = false;
try {
  await removeStampedPdfsThen(
    {
      from() {
        return {
          async remove() {
            return { error: new Error("simulated local Storage outage") };
          },
        };
      },
    },
    cleanup.storagePaths,
    () => admin.rpc("complete_recipient_anonymization", {
      p_actor_id: owner.id,
      p_recipient_id: recipientRow.id,
    }),
  );
} catch {
  storageFailureObserved = true;
}
assert(storageFailureObserved, "simulated Storage failure was not surfaced");

const { data: pendingRecipient, error: pendingError } = await admin
  .from("recipients")
  .select("anonymization_requested_at, anonymized_at, full_name, email")
  .eq("id", recipientRow.id)
  .single();
const pending = requireResult(pendingRecipient, pendingError, "inspect pending anonymization");
assert(
  pending.anonymization_requested_at
    && !pending.anonymized_at
    && pending.full_name === "Synthetic Recipient QA"
    && pending.email === "synthetic-qa@example.test",
  "recipient did not remain pending after the simulated Storage failure",
);

const { data: stillStored, error: stillStoredError } = await admin.storage
  .from(STAMPED_PDF_BUCKET)
  .download(storagePath);
requireResult(stillStored, stillStoredError, "confirm object remains after simulated failure");

const { data: retryPlan, error: retryPrepareError } = await admin.rpc(
  "prepare_recipient_anonymization",
  { p_actor_id: owner.id, p_recipient_id: recipientRow.id },
);
const retry = requireResult(retryPlan, retryPrepareError, "prepare anonymization retry");
await removeStampedPdfsThen(
  admin.storage,
  retry.storagePaths,
  () => admin.rpc("complete_recipient_anonymization", {
    p_actor_id: owner.id,
    p_recipient_id: recipientRow.id,
  }),
);

const { data: deletedObject, error: deletedObjectError } = await admin.storage
  .from(STAMPED_PDF_BUCKET)
  .download(storagePath);
assert(!deletedObject && deletedObjectError, "stamped object still exists after anonymization retry");

const { data: anonymizedRecipient, error: anonymizedError } = await admin
  .from("recipients")
  .select("anonymized_at, full_name, email")
  .eq("id", recipientRow.id)
  .single();
const finalRecipient = requireResult(anonymizedRecipient, anonymizedError, "inspect anonymized recipient");
assert(
  finalRecipient.anonymized_at && !finalRecipient.full_name && !finalRecipient.email,
  "recipient PII was not cleared after Storage deletion",
);

const { data: finalStampFile, error: finalStampFileError } = await admin
  .from("stamp_files")
  .select("status, storage_path, drive_file_id, source_sha256, output_sha256")
  .eq("id", stampFileId)
  .single();
const deletedFile = requireResult(finalStampFile, finalStampFileError, "inspect anonymized stamp file");
assert(
  deletedFile.status === "deleted"
    && !deletedFile.storage_path
    && !deletedFile.drive_file_id
    && !deletedFile.source_sha256
    && !deletedFile.output_sha256,
  "anonymization retained stamped file references",
);

const { data: finalCredential, error: finalCredentialError } = await admin
  .from("credentials")
  .select("status")
  .eq("id", credentialId)
  .single();
const revokedCredential = requireResult(finalCredential, finalCredentialError, "inspect retained credential");
assert(revokedCredential.status === "revoked", "credential was not revoked during anonymization");

console.log(JSON.stringify({
  result: "PASS",
  objectUploadedToLocalPrivateStorage: true,
  simulatedStorageFailureLeftRecipientPending: true,
  retryRemovedObjectFromStorage: true,
  recipientPiiCleared: true,
  credentialRevokedAndRetained: true,
}));
