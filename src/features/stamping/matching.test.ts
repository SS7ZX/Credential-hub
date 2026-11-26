import { describe, expect, it } from 'vitest'
import { matchStampFiles, parseStampCsv, type DriveCandidate, type StampableCredential } from './matching'

const row = 'Adnan Syukur,adnan@example.test,Seminar,Adnan Syukur.pdf'
const credential: StampableCredential = {
  credential_id: 'credential-1',
  serial_number: 'SAMPLE-001',
  recipient_id: 'recipient-1',
  full_name: 'Adnan Syukur',
  email: 'adnan@example.test',
  event_id: 'event-1',
  achievement_id: 'achievement-1',
}
const file = (name: string, id = 'drive-file-1'): DriveCandidate => ({
  id,
  name,
  mimeType: 'application/pdf',
  size: '1234',
  folderId: 'folder-1',
  folderName: 'Seminar',
})

describe('stamp CSV matching', () => {
  it('requires all approved columns, a nonempty email, and exact file names', () => {
    expect(() => parseStampCsv('full_name,email,file_name\nName,a@example.test,Name.pdf')).toThrow(/category/)
    expect(() => parseStampCsv('full_name,email,category,file_name\nName, ,Event,Name.pdf')).toThrow(/missing email/)
    expect(parseStampCsv(`full_name,email,category,file_name\n${row}`)[0].email).toBe('adnan@example.test')
  })

  it('maps exact file name and credential identity without fuzzy matching', () => {
    const rows = parseStampCsv(`full_name,email,category,file_name\n${row}`)
    const result = matchStampFiles(rows, [file('Adnan Syukur.pdf')], new Map([['folder-1', 'achievement-1']]), [credential])
    expect(result.issues).toEqual([])
    expect(result.pairs).toHaveLength(1)
  })

  it('hard-fails missing, extra, duplicate, case-collision, and wrong-recipient matches', () => {
    const rows = parseStampCsv(`full_name,email,category,file_name\n${row}\nOther,o@example.test,Seminar,Missing.pdf`)
    const result = matchStampFiles(
      rows,
      [file('Adnan Syukur.pdf'), file('adnan syukur.PDF', 'drive-file-2'), file('Extra.pdf', 'drive-file-3')],
      new Map([['folder-1', 'achievement-1']]),
      [credential],
    )
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_file',
      'extra_file',
      'case_collision',
      'credential_missing',
    ]))

    const wrongName = matchStampFiles(
      [{ ...parseStampCsv(`full_name,email,category,file_name\n${row}`)[0], full_name: 'Wrong Person' }],
      [file('Adnan Syukur.pdf')],
      new Map([['folder-1', 'achievement-1']]),
      [credential],
    )
    expect(wrongName.issues[0]?.code).toBe('recipient_name_mismatch')
  })

  it('rejects duplicate names, duplicate credentials, and unconfirmed folder mappings', () => {
    const rows = parseStampCsv(`full_name,email,category,file_name\n${row}\n${row}`)
    const duplicate = matchStampFiles(
      rows,
      [file('Adnan Syukur.pdf'), file('Adnan Syukur.pdf', 'drive-file-2')],
      new Map([['folder-1', 'achievement-1']]),
      [credential],
    )
    expect(duplicate.issues.map((issue) => issue.code)).toContain('duplicate_file')

    const unmapped = matchStampFiles(
      [rows[0]],
      [file('Adnan Syukur.pdf')],
      new Map(),
      [credential],
    )
    expect(unmapped.issues.map((issue) => issue.code)).toContain('unmapped_folder')
  })
})
