import Papa from 'papaparse'

export type CertificateCsvRow = {
  full_name: string
  email: string
  category: string
  file_name: string
}

export type DriveCandidate = {
  id: string
  name: string
  mimeType: string
  size?: string
  folderId: string
  folderName: string
}

export type StampableCredential = {
  credential_id: string
  serial_number: string
  recipient_id: string
  full_name: string | null
  email: string | null
  event_id: string | null
  achievement_id: string
}

export type MatchIssue = {
  code: string
  detail: string
}

export type MatchedPair = {
  row: CertificateCsvRow
  file: DriveCandidate
  credential: StampableCredential
  achievementId: string
}

export type MatchResult = {
  pairs: MatchedPair[]
  issues: MatchIssue[]
}

const REQUIRED_COLUMNS = ['full_name', 'email', 'category', 'file_name'] as const

export function parseStampCsv(text: string): CertificateCsvRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  if (parsed.errors.length) throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`)
  const headers = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column))
  if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(', ')}`)
  if (!parsed.data.length || parsed.data.length > 300) {
    throw new Error('The stamping CSV must contain between 1 and 300 rows.')
  }
  const rows = parsed.data.map((row, index) => {
    const fullName = collapseWhitespace(row.full_name ?? '')
    const email = normalizeEmail(row.email ?? '')
    const category = row.category ?? ''
    const fileName = row.file_name ?? ''
    if (!fullName) throw new Error(`CSV row ${index + 2} is missing full_name.`)
    if (!email) throw new Error(`CSV row ${index + 2} is missing email.`)
    if (!fileName) throw new Error(`CSV row ${index + 2} is missing file_name.`)
    return { full_name: fullName, email, category, file_name: fileName }
  })
  return rows
}

export function matchStampFiles(
  rows: readonly CertificateCsvRow[],
  files: readonly DriveCandidate[],
  achievementByFolder: ReadonlyMap<string, string>,
  credentials: readonly StampableCredential[],
): MatchResult {
  const issues: MatchIssue[] = []
  const pairs: MatchedPair[] = []
  const csvByName = groupBy(rows, (row) => row.file_name)
  const driveByName = groupBy(files, (file) => file.name)
  const csvByLowerName = groupBy(rows, (row) => row.file_name.toLowerCase())
  const driveByLowerName = groupBy(files, (file) => file.name.toLowerCase())
  const credentialByAchievementAndEmail = groupBy(
    credentials,
    (credential) => `${credential.achievement_id}:${normalizeEmail(credential.email ?? '')}`,
  )

  for (const [name, collisions] of csvByLowerName) {
    if (collisions.length > 1 && new Set(collisions.map((row) => row.file_name)).size > 1) {
      issues.push({ code: 'case_collision', detail: `CSV file names differ only by case: ${name}` })
    }
  }
  for (const [name, collisions] of driveByLowerName) {
    if (collisions.length > 1 && new Set(collisions.map((file) => file.name)).size > 1) {
      issues.push({ code: 'case_collision', detail: `Drive files differ only by case: ${name}` })
    }
  }

  for (const [name, duplicateRows] of csvByName) {
    if (duplicateRows.length > 1) {
      issues.push({ code: 'duplicate_file', detail: `CSV maps more than one row to "${name}".` })
    }
  }
  for (const [name, duplicateFiles] of driveByName) {
    if (duplicateFiles.length > 1) {
      issues.push({ code: 'duplicate_file', detail: `Drive contains more than one exact match for "${name}".` })
    }
  }

  const matchedIds = new Set<string>()
  for (const row of rows) {
    const exactFiles = driveByName.get(row.file_name) ?? []
    if (!exactFiles.length) {
      issues.push({ code: 'missing_file', detail: `No exact Drive file match for "${row.file_name}".` })
      continue
    }
    if (exactFiles.length !== 1) continue

    const file = exactFiles[0]
    matchedIds.add(file.id)
    if (file.mimeType !== 'application/pdf') {
      issues.push({ code: 'invalid_mime', detail: `"${file.name}" is not application/pdf.` })
      continue
    }
    const achievementId = achievementByFolder.get(file.folderId)
    if (!achievementId) {
      issues.push({ code: 'unmapped_folder', detail: `Confirm an achievement for the Drive folder "${file.folderName}".` })
      continue
    }
    const emailKey = `${achievementId}:${normalizeEmail(row.email)}`
    const matches = credentialByAchievementAndEmail.get(emailKey) ?? []
    if (!matches.length) {
      issues.push({ code: 'credential_missing', detail: `No issued credential matches email for "${row.file_name}".` })
      continue
    }
    if (matches.length > 1) {
      issues.push({ code: 'credential_ambiguous', detail: `More than one issued credential matches "${row.file_name}".` })
      continue
    }
    const credential = matches[0]
    if (collapseWhitespace(credential.full_name ?? '') !== collapseWhitespace(row.full_name)) {
      issues.push({ code: 'recipient_name_mismatch', detail: `CSV name does not match the issued recipient for "${row.file_name}".` })
      continue
    }
    pairs.push({ row, file, credential, achievementId })
  }

  for (const file of files) {
    if (!matchedIds.has(file.id)) {
      issues.push({ code: 'extra_file', detail: `Drive file "${file.name}" has no exact CSV row.` })
    }
  }

  const duplicateCredentials = groupBy(pairs, (pair) => `${pair.achievementId}:${pair.credential.credential_id}`)
  for (const matches of duplicateCredentials.values()) {
    if (matches.length > 1) {
      issues.push({
        code: 'duplicate_credential',
        detail: `The same issued credential is matched to more than one PDF (${matches.length} rows).`,
      })
    }
  }
  return { pairs, issues }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function sanitizeCsvFormulaCell(value: string): string {
  if (/^[=+\-@]/u.test(value)) return `'${value}`
  return value
}

export function buildRunReportCsv(pairs: readonly ReviewPairForReport[], achName: string): string {
  const headers = ['achievement', 'full_name', 'file_name', 'credential_serial', 'status', 'error_code']
  const rows = pairs.map((pair) => [
    achName,
    pair.fullName,
    pair.fileName,
    pair.serial,
    pair.status,
    pair.errorCode ?? '',
  ].map((value) => sanitizeCsvFormulaCell(String(value))).map(csvQuote).join(','))
  return [headers.join(','), ...rows].join('\r\n')
}

export type ReviewPairForReport = {
  fullName: string
  fileName: string
  serial: string
  status: string
  errorCode: string | null
}

function csvQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    const group = result.get(key)
    if (group) group.push(value)
    else result.set(key, [value])
  }
  return result
}
