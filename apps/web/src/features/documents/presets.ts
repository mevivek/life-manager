import type { DocumentType } from '@life-manager/shared'

/**
 * The documents a person in India actually owns, as data.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why a table, and why it is client-side
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The capture form's hardest problem is not validation, it is the blank field. "Title" with a cursor
 * in it asks the user to invent a naming convention; a row of pills asks them to recognise something.
 * One tap fills the title, the type and the issuer, and renames the number field to what the document
 * itself calls that number — "Aadhaar number · 12 digits" rather than "Number".
 *
 * **It is presentation, not a business rule**, which is why it lives in the client and not in
 * `packages/shared` (invariant 5 cuts the other way here: nothing server-side reads this, and nothing
 * depends on it being right). A preset is a shortcut for typing. Every field it fills stays editable,
 * and ignoring the row entirely is a supported way to use the form — it sits *above* the title field
 * precisely so it can be skipped rather than answered.
 *
 * **India-only, on purpose and not as an oversight.** The app has one user. A generic list that
 * covered every country would name none of these correctly, and "Vehicle RC" vs "V5C" is exactly the
 * kind of difference that makes a shortcut worth having. A second country ships its own array and a
 * way to choose between them; nothing about the UI changes, because the UI reads a list.
 *
 * `expires` is **advisory copy only** — it decides one sentence. It does not set a date, does not
 * create a reminder, and must not: reminders come from `expires_on` server-side (invariant 5), and a
 * preset claiming "this expires" while the user leaves the date blank would produce a document that
 * looks watched and is not.
 */

export type Preset = {
  name: string
  type: DocumentType
  /** Blank where the issuer genuinely varies — insurers and banks, which we must not guess. */
  issuer: string
  /** What the document itself calls its number. This is the label the field takes. */
  numLabel: string
  /** The shape, where stating it helps the user check what they typed. Blank where it varies. */
  shape: string
  /** Advisory only — one sentence of copy. Never a reminder, never a date. */
  expires: boolean
  /** In the default row of nine. The rest are behind "All 22". */
  common?: boolean
  /** Only where a real example clarifies the format more than a description does. */
  placeholder?: string
}

export const PRESETS: Preset[] = [
  {
    name: 'Aadhaar',
    type: 'identity',
    issuer: 'UIDAI',
    numLabel: 'Aadhaar number',
    shape: '12 digits',
    expires: false,
    common: true,
    placeholder: '7294 8103 8109',
  },
  {
    name: 'PAN card',
    type: 'identity',
    issuer: 'Income Tax Department',
    numLabel: 'PAN',
    shape: '10 characters',
    expires: false,
    common: true,
    placeholder: 'ABCDE1234F',
  },
  {
    name: 'Passport',
    type: 'identity',
    issuer: 'Ministry of External Affairs',
    numLabel: 'Passport number',
    shape: '1 letter + 7 digits',
    expires: true,
    common: true,
    placeholder: 'M1234567',
  },
  {
    name: 'Driving licence',
    type: 'identity',
    issuer: 'Regional Transport Office',
    numLabel: 'Licence number',
    shape: 'state code + 13',
    expires: true,
    common: true,
  },
  {
    name: 'Voter ID',
    type: 'identity',
    issuer: 'Election Commission of India',
    numLabel: 'EPIC number',
    shape: '3 letters + 7 digits',
    expires: false,
    common: true,
  },
  {
    name: 'Vehicle RC',
    type: 'legal',
    issuer: 'Regional Transport Office',
    numLabel: 'Registration number',
    shape: 'e.g. MH12AB1234',
    expires: false,
    common: true,
    placeholder: 'MH12AB1234',
  },
  {
    name: 'Vehicle insurance',
    type: 'financial',
    issuer: '',
    numLabel: 'Policy number',
    shape: '',
    expires: true,
    common: true,
  },
  {
    name: 'Health insurance',
    type: 'financial',
    issuer: '',
    numLabel: 'Policy number',
    shape: '',
    expires: true,
    common: true,
  },
  {
    name: 'PUC certificate',
    type: 'certificate',
    issuer: 'Authorised PUC centre',
    numLabel: 'Certificate number',
    shape: '',
    expires: true,
    common: true,
  },
  {
    name: 'Birth certificate',
    type: 'certificate',
    issuer: 'Municipal Corporation',
    numLabel: 'Registration number',
    shape: '',
    expires: false,
  },
  {
    name: 'Marriage certificate',
    type: 'certificate',
    issuer: 'Office of the Registrar of Marriages',
    numLabel: 'Registration number',
    shape: '',
    expires: false,
  },
  {
    name: 'Ration card',
    type: 'identity',
    issuer: 'Department of Food & Civil Supplies',
    numLabel: 'Ration card number',
    shape: '',
    expires: false,
  },
  {
    name: 'LPG connection',
    type: 'other',
    issuer: 'Indane / HP Gas / Bharat Gas',
    numLabel: 'Consumer number',
    shape: '',
    expires: false,
  },
  {
    name: 'Electricity bill',
    type: 'receipt',
    issuer: 'State electricity board',
    numLabel: 'Consumer number',
    shape: '',
    expires: false,
  },
  {
    name: 'Property tax receipt',
    type: 'receipt',
    issuer: 'Municipal Corporation',
    numLabel: 'Property ID',
    shape: '',
    expires: false,
  },
  {
    name: 'Rent agreement',
    type: 'legal',
    issuer: '',
    numLabel: 'Agreement number',
    shape: '',
    expires: true,
  },
  {
    name: 'Form 16',
    type: 'financial',
    issuer: 'Employer',
    numLabel: 'TAN of deductor',
    shape: '10 characters',
    expires: false,
  },
  {
    name: 'ITR acknowledgement',
    type: 'financial',
    issuer: 'Income Tax Department',
    numLabel: 'Acknowledgement no.',
    shape: '15 digits',
    expires: false,
  },
  {
    name: 'EPF / UAN',
    type: 'financial',
    issuer: 'EPFO',
    numLabel: 'UAN',
    shape: '12 digits',
    expires: false,
  },
  {
    name: 'Degree certificate',
    type: 'certificate',
    issuer: 'University',
    numLabel: 'Enrolment number',
    shape: '',
    expires: false,
  },
  {
    name: 'Ayushman card',
    type: 'identity',
    issuer: 'National Health Authority',
    numLabel: 'PMJAY ID',
    shape: '',
    expires: false,
  },
  {
    name: 'Bank passbook',
    type: 'financial',
    issuer: '',
    numLabel: 'Account number',
    shape: '',
    expires: false,
  },
]

export const COMMON_PRESETS = PRESETS.filter((preset) => preset.common === true)

export function presetByName(name: string): Preset | null {
  return PRESETS.find((preset) => preset.name === name) ?? null
}

/** The default when no preset is in play. Also the fallback label on the detail screen. */
export const GENERIC_NUMBER_LABEL = 'Number'

/**
 * What to call this document's number, on a document that was saved some time ago.
 *
 * Matched on the **title**, because that is what the preset filled in and the only durable trace it
 * leaves — the app deliberately does not store "which preset made this". Storing it would be a fourth
 * kind of type (`doc_type`, `custom_attrs`, tags, and now a preset id) describing the same document,
 * and the presets are a typing shortcut rather than a taxonomy.
 *
 * Case-insensitive and exact after trimming: a loose `includes()` match would label a document called
 * "Passport photos" as carrying a passport number. `docType` is accepted but not currently consulted —
 * it is here so that a future disambiguation between two presets of the same name can use it without
 * changing every call site.
 */
export function numberLabelFor(title: string, _docType: DocumentType): string {
  const needle = title.trim().toLowerCase()
  const match = PRESETS.find((preset) => preset.name.toLowerCase() === needle)
  return match?.numLabel ?? GENERIC_NUMBER_LABEL
}
