import {
  type DocumentCreate,
  documentCreateSchema,
  KIND_LABELS,
  SERIAL_LABELS,
  type ThingKind,
  thingCreateSchema,
} from '@life-manager/shared'
import type { z } from 'zod'
import { formatDate } from './ExpiryStatus'
import { significant } from './numberFormat'
import { presetByName } from './presets'

/**
 * The capture wizard's data and its pure functions. `CaptureSheet.tsx` is the React half.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  ADR-0030: capture is a stepped wizard on TWO TRACKS, and exactly ONE field is required
 *  per track.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Everything in this file exists to keep two claims mechanically checkable rather than merely
 * intended:
 *
 * 1. **A draft with only the required field turns into a valid payload.** `toDocumentCreate` and
 *    `toThingCreate` are total over the draft types — there is no branch that can refuse — so a save
 *    after skipping every enrichment step is a shape question, not a validation question. Q2
 *    (product/open-questions.md §2) and things.md §4 rule 1 are the decisions being defended, and
 *    ADR-0030's own § Consequences names "a wizard is a place where required creeps back in" as the
 *    single most likely regression here.
 * 2. **The saved step tells the truth about what went in.** `savedFacts` reads back what the record
 *    holds and `savedGaps` names what it does not, from the same draft the payload was built from —
 *    so a field that silently failed to reach the payload cannot be reported as saved.
 *
 * Extracted from the component for the same reason `numberFormat.ts` is: this is the part most likely
 * to be subtly wrong, and driving it through a rendered wizard would test React as much as the logic.
 */

// ── The two tracks ───────────────────────────────────────────────────────────

export type CaptureTrack = 'document' | 'thing'

/** ADR-0030: `type → whose → title → number → dates → scan`. */
export const DOC_STEPS = ['type', 'whose', 'title', 'number', 'dates', 'scan'] as const
export type DocStep = (typeof DOC_STEPS)[number]

/** ADR-0030: `kind → name → detail → purchase → warranty → photo`. */
export const THING_STEPS = ['kind', 'name', 'detail', 'purchase', 'warranty', 'photo'] as const
export type ThingStep = (typeof THING_STEPS)[number]

export type CaptureStep = DocStep | ThingStep

/**
 * The one required field per track, as a step name.
 *
 * **This is the whole of "required" in the wizard**, and it is deliberately a lookup rather than a
 * flag on each step: a step is skippable *because it is not this one*, so there is no second place
 * where a `required: true` could be added to a step definition without also being read here.
 */
export const REQUIRED_STEP: Record<CaptureTrack, CaptureStep> = {
  document: 'title',
  thing: 'name',
}

/**
 * The heading and the sub-line for each step. From handoff 4's `STEP_COPY` / `PSTEP_COPY`, with the
 * dynamic ones (`number`, and the thing track's kind-dependent lines) computed in the component.
 *
 * Not routed through `lib/voice.ts`: these are the wizard's *labels* rather than its prose. The voice
 * registers rewrite ~9 sentences of narration (design.md §12); a step heading that changed wording
 * per register would make the same screen unrecognisable between two devices belonging to one person.
 */
export const STEP_COPY: Record<CaptureStep, { heading: string; sub: string }> = {
  type: {
    heading: 'What kind of document is it?',
    sub: 'Pick the closest match. It sets the number label, the issuer and whether we watch for an expiry.',
  },
  whose: {
    heading: 'Whose document is it?',
    sub: 'Filing a document for someone else keeps it in your lists — they get no account and no notification.',
  },
  title: {
    heading: 'What should we call it?',
    sub: 'Prefilled from the type. Change it to whatever you’d search for.',
  },
  number: { heading: 'The number on it', sub: '' },
  dates: {
    heading: 'Issued and expires',
    sub: 'The expiry date is the one that matters — it’s what we count down to and remind you about.',
  },
  scan: { heading: 'Add a photo of it', sub: 'Optional, and easy to add later.' },

  kind: {
    heading: 'What kind of thing is it?',
    sub: 'It decides which fields we ask for, and whether we watch a warranty or a service date.',
  },
  name: { heading: 'What is it?', sub: '' },
  detail: {
    heading: 'Anything else on it?',
    sub: 'All optional. Worth two taps now if you’d otherwise be reading it off the back of the thing later.',
  },
  purchase: { heading: 'When did you buy it?', sub: '' },
  warranty: {
    heading: 'How long is it covered?',
    sub: 'Pick a length and we’ll work out the date. Skip it if there’s no cover.',
  },
  photo: { heading: 'Add a photo', sub: '' },
}

// ── The thing track's kind-conditional fields ────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This table is the REASON the wizard exists. ADR-0030 § Context.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A vehicle wants a make, a model and a registration; a gold chain wants plain words, a detail and a
 * hallmark. One page holding the union of those would render, in the common case, a screen of fields
 * that do not apply — which is the friction Q2 forbids.
 *
 * ── Every field here maps onto a real column, and the ones that do not were dropped ──
 *
 * Handoff 4's `PFIELDS` also asks a vehicle for **Fuel** and **Year**. `things` has neither
 * (things.md §3), and in the comp both were static inputs wired to nothing. They are left out rather
 * than folded into `notes`: `notes` is prose a person writes, and a client inventing `"Fuel: Petrol"`
 * in it would be a schema convention no server, importer or future screen knows about (invariant 9).
 * If they are wanted, they are two columns and a migration.
 *
 * ── `isMake` is what decides the record's NAME ──
 *
 * `name` is the only required field, and a make alone is not the name of a thing: "Volkswagen" is not
 * an object you own, "Gold chain" is. So where the lead field is a *make*, the name is the make plus
 * the model ("Volkswagen Golf 1.5 TSI Life") and the make is also stored as `brand`; where the lead
 * field already names the thing, it is the name on its own and there is no brand to store.
 */
export type ThingFieldSet = {
  lead: { label: string; placeholder: string; isMake: boolean }
  /** The second field on the `name` step. `null` for kinds with nothing useful to ask. */
  model: { label: string; placeholder: string } | null
  /** The `detail` step's serial-ish field. Its label comes from `SERIAL_LABELS` — rule 8. */
  serialPlaceholder: string
  /** One sentence saying what that number is *for*, which is what makes it worth typing. */
  serialHint: string
}

const INSURER_SERIAL_HINT = 'Optional — the one an insurer or the police will ask for.'

export const THING_FIELDS: Record<ThingKind, ThingFieldSet> = {
  phone: {
    lead: { label: 'Make', placeholder: 'Apple', isMake: true },
    model: { label: 'Model', placeholder: 'iPhone 15 Pro, 256GB' },
    serialPlaceholder: '35 693803 564380 9',
    serialHint: INSURER_SERIAL_HINT,
  },
  laptop: {
    lead: { label: 'Make', placeholder: 'Apple', isMake: true },
    model: { label: 'Model', placeholder: 'MacBook Air M3, 16GB' },
    serialPlaceholder: 'C02XL0RTJGH7',
    serialHint: INSURER_SERIAL_HINT,
  },
  tablet: {
    lead: { label: 'Make', placeholder: 'Apple', isMake: true },
    model: { label: 'Model', placeholder: 'iPad Air 11-inch' },
    serialPlaceholder: 'DMPX2LL9GH',
    serialHint: INSURER_SERIAL_HINT,
  },
  vehicle: {
    lead: { label: 'Make', placeholder: 'Maruti Suzuki', isMake: true },
    model: { label: 'Model', placeholder: 'Swift VXi' },
    serialPlaceholder: 'KA 01 AB 1234',
    serialHint: 'The plate. It’s what a fine, a claim or a parking appeal will ask for.',
  },
  appliance: {
    lead: { label: 'Make', placeholder: 'Bosch', isMake: true },
    model: { label: 'Model', placeholder: 'Series 6 SMV6' },
    serialPlaceholder: 'FD9902441',
    serialHint: INSURER_SERIAL_HINT,
  },
  av: {
    lead: { label: 'Make', placeholder: 'LG', isMake: true },
    model: { label: 'Model', placeholder: 'OLED65C34LA' },
    serialPlaceholder: '312NAWM4K881',
    serialHint: INSURER_SERIAL_HINT,
  },
  furniture: {
    lead: { label: 'Make or shop', placeholder: 'Ercol', isMake: true },
    model: { label: 'What it is', placeholder: 'Dining table, oak, 6-seat' },
    serialPlaceholder: 'JL-88213391',
    serialHint: 'The order number. On furniture it is what a shop will look you up by.',
  },
  tool: {
    lead: { label: 'Make', placeholder: 'Bosch', isMake: true },
    model: { label: 'Model', placeholder: 'GSB 18V-55' },
    serialPlaceholder: '3165140974',
    serialHint: INSURER_SERIAL_HINT,
  },
  valuable: {
    // Not a make. "Gold chain" IS the name of the thing — see `isMake` above.
    lead: { label: 'What it is', placeholder: 'Gold chain', isMake: false },
    model: { label: 'Detail', placeholder: '22ct, 18 inch' },
    serialPlaceholder: '916',
    serialHint: 'The hallmark, if it carries one.',
  },
  /**
   * The fallback, reached by **skipping the kind step** — `thingCreateSchema` defaults `kind` to
   * `other` and `CAPTURE_KINDS` deliberately omits it, so this is never *chosen* (shared/things.ts).
   * It asks for a name and a serial and nothing else, because there is no kind to ask on behalf of.
   */
  other: {
    lead: { label: 'What it is', placeholder: 'MacBook Air M3', isMake: false },
    model: null,
    serialPlaceholder: 'Optional',
    serialHint: INSURER_SERIAL_HINT,
  },
}

/**
 * What a kind is worth saying beyond its label: an example for the name step, and the odd kind whose
 * name or photo needs different advice. From handoff 4's `PKINDS`.
 */
export const KIND_META: Partial<
  Record<ThingKind, { example: string; noun: string; nameSub?: string; photoSub?: string }>
> = {
  phone: { example: 'iPhone 15 Pro', noun: 'phone' },
  laptop: { example: 'MacBook Air M3', noun: 'laptop' },
  tablet: { example: 'iPad Air 11-inch', noun: 'tablet' },
  vehicle: {
    example: 'Maruti Suzuki Swift',
    noun: 'car',
    photoSub: 'One of the car, and one of the plate or the VIN if you can reach it.',
  },
  appliance: { example: 'Bosch dishwasher', noun: 'appliance' },
  av: { example: 'LG OLED C3 65″', noun: 'telly' },
  furniture: {
    example: 'Ercol dining table',
    noun: 'table',
    nameSub:
      'The shop or maker, then what the thing actually is — that’s how you’ll look for it.',
    photoSub: 'One of the piece. The order number on a receipt matters more here than a serial plate.',
  },
  tool: { example: 'Bosch GSB 18V drill', noun: 'drill' },
  valuable: {
    example: '22ct gold chain',
    noun: 'chain',
    nameSub:
      'Plain words first — “gold chain” — then the detail that tells it apart from another one.',
    photoSub:
      'Photograph it against something plain. This is the picture an insurer or the police will want.',
  },
}

/**
 * Make and model suggestions. **Chips over a free-text field, never a closed list** — things.md §9(1)
 * settles that `brand` and `model` stay free text, exactly as a document's `issuer` does, and a
 * suggestion list is not a foreign key. The point is that the common case is two taps instead of
 * typing a make on a phone keyboard; anything not listed is typed and stored verbatim.
 */
export const MAKES: Partial<Record<ThingKind, readonly string[]>> = {
  vehicle: [
    'Maruti Suzuki',
    'Hyundai',
    'Tata',
    'Mahindra',
    'Honda',
    'Toyota',
    'Volkswagen',
    'Royal Enfield',
    'Bajaj',
  ],
  phone: ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Google', 'Nothing'],
  laptop: ['Apple', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer'],
  tablet: ['Apple', 'Samsung', 'Lenovo', 'Xiaomi'],
  appliance: ['Bosch', 'Samsung', 'LG', 'Whirlpool', 'IFB', 'Voltas'],
  av: ['LG', 'Samsung', 'Sony', 'TCL', 'Sonos'],
  tool: ['Bosch', 'Makita', 'DeWalt', 'Black+Decker'],
}

/** Keyed by the **make as typed**, so a make chip and a hand-typed make offer the same models. */
export const MODELS: Record<string, readonly string[]> = {
  'Maruti Suzuki': ['Swift', 'Baleno', 'Brezza', 'Fronx', 'Ertiga'],
  Hyundai: ['i20', 'Creta', 'Venue', 'Verna'],
  Tata: ['Nexon', 'Punch', 'Harrier', 'Tiago'],
  Mahindra: ['Thar', 'XUV700', 'Scorpio-N', 'Bolero'],
  Honda: ['City', 'Amaze', 'Elevate', 'Activa 6G'],
  Toyota: ['Innova Crysta', 'Fortuner', 'Glanza', 'Urban Cruiser'],
  Volkswagen: ['Golf', 'Polo', 'Virtus', 'Taigun'],
  'Royal Enfield': ['Classic 350', 'Hunter 350', 'Himalayan', 'Meteor 350'],
  Bajaj: ['Pulsar 150', 'Chetak', 'Dominar 400'],
  Apple: ['iPhone 15 Pro', 'iPhone 14', 'MacBook Air M3', 'MacBook Pro 14', 'iPad Air'],
  Samsung: ['Galaxy S24', 'Galaxy A55', 'Galaxy Tab S9', 'OLED S90D'],
  OnePlus: ['12R', 'Nord 4'],
  Xiaomi: ['Redmi Note 13', 'Pad 6'],
  Google: ['Pixel 8a', 'Pixel 9'],
  Nothing: ['Phone (2a)', 'Phone (2)'],
  Dell: ['XPS 13', 'Inspiron 15', 'Latitude 5450'],
  HP: ['Pavilion 14', 'Envy x360', 'Victus 15'],
  Lenovo: ['ThinkPad E14', 'IdeaPad Slim 5', 'Tab P12'],
  Asus: ['Vivobook 15', 'Zenbook 14', 'ROG Strix G16'],
  Acer: ['Aspire 5', 'Swift Go 14'],
  Bosch: ['Series 6 SMV6', 'WAJ2426WIN', 'GSB 18V-55'],
  LG: ['OLED65C3', '1.5T DUALCOOL', 'Front Load FHM1207'],
  Whirlpool: ['Intellifresh 235L', 'MagiCool 1.5T'],
  IFB: ['Elena ZX', 'Neptune VX'],
  Voltas: ['1.5T Vectra', 'Beko 253L'],
  Sony: ['Bravia X80L', 'HT-S2000'],
  TCL: ['C755 QD-Mini LED'],
  Sonos: ['Era 100', 'Beam Gen 2'],
  Makita: ['DHP484Z', 'DTD153Z'],
  DeWalt: ['DCD778', 'DCF887'],
  'Black+Decker': ['BDCHD18', 'BEH710'],
}

// ── Drafts ───────────────────────────────────────────────────────────────────

/**
 * Both drafts hold **strings, never nulls**, and every field starts `''`.
 *
 * A cleared input yields `''`, and the schemas reject `''` for a nullable field — so the conversion
 * has to happen in exactly one place on the way out (`toDocumentCreate` / `toThingCreate`) rather than
 * per field at each call site. `DocumentForm` learned this the hard way: validating raw form values
 * meant a document with no expiry could not be submitted at all, which broke the precise case Q2
 * exists to protect.
 */
export type DocumentDraft = {
  /** The chosen preset's NAME, `''` for none — so a selected chip survives a re-render by value. */
  preset: string
  docType: DocumentCreate['doc_type']
  title: string
  identifier: string
  holder: string
  relation: string
  issuer: string
  issuedOn: string
  expiresOn: string
  country: string
}

export type ThingDraft = {
  /** `''` means the kind step was skipped; the payload then takes the schema's `other`. */
  kind: ThingKind | ''
  /** The lead field — a make, or the thing's own name. See `THING_FIELDS`. */
  lead: string
  model: string
  serial: string
  purchasedOn: string
  price: string
  /** `null` until answered. `0` is the answer "No cover", which is not the same as unanswered. */
  coverMonths: number | null
  /** Used only when there is no purchase date to count the cover from — see `coverEndsOn`. */
  coverEndsOn: string
}

export const EMPTY_DOCUMENT_DRAFT: DocumentDraft = {
  preset: '',
  docType: 'other',
  title: '',
  identifier: '',
  holder: '',
  relation: '',
  issuer: '',
  issuedOn: '',
  expiresOn: '',
  country: '',
}

export const EMPTY_THING_DRAFT: ThingDraft = {
  kind: '',
  lead: '',
  model: '',
  serial: '',
  purchasedOn: '',
  price: '',
  coverMonths: null,
  coverEndsOn: '',
}

/** The kind whose field set governs, which is `other` while the kind step is unanswered. */
export function fieldsFor(kind: ThingKind | ''): ThingFieldSet {
  return THING_FIELDS[kind === '' ? 'other' : kind]
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// ── Draft → payload ──────────────────────────────────────────────────────────

/**
 * The draft as `documentCreateSchema`'s **input**, ready to be parsed.
 *
 * Returned unparsed on purpose: the schema is the contract (ADR-0004, invariant 9) and the wizard
 * runs it so a rejection surfaces the schema's own message — `country` is the field that reaches it in
 * practice, since `IND` is a natural thing to type into a two-letter code.
 *
 * `relation` cannot outlive `holder` (documents.md §4 rule 13), so both are written from one
 * expression here rather than from two independent fields.
 */
export function toDocumentCreate(
  draft: DocumentDraft,
  thingId?: string,
): z.input<typeof documentCreateSchema> {
  const holder = blankToNull(draft.holder)
  const country = blankToNull(draft.country)
  return {
    title: draft.title.trim(),
    doc_type: draft.docType,
    issuer: blankToNull(draft.issuer),
    identifier: blankToNull(draft.identifier),
    holder,
    relation: holder === null ? null : blankToNull(draft.relation),
    thing_id: thingId ?? null,
    issued_on: blankToNull(draft.issuedOn),
    expires_on: blankToNull(draft.expiresOn),
    // Uppercased, because `countryCodeSchema` is `^[A-Z]{2}$` and rejecting `in` for its case would
    // be a pointless 400 on a value the user typed correctly. Same treatment as `DocumentForm`.
    country: country === null ? null : country.toUpperCase(),
    notes: null,
    tags: [],
    custom_attrs: {},
  }
}

/**
 * The currency every captured price is stored in.
 *
 * `price` and `currency` move together — things.md §3 says `currency` is non-null whenever `price`
 * is — and the wizard asks for one number rather than a number and a picker, because
 * `presets.ts` is explicitly India-only and a currency chooser on the capture fast path would be a
 * control with one plausible answer. A second country ships a picker along with its preset table.
 */
export const CAPTURE_CURRENCY = 'INR'

/**
 * The draft as `thingCreateSchema`'s input.
 *
 * `ownership` is deliberately absent — a thing is created `here` and the state moves through `PATCH`
 * (shared/things.ts). `holder` is absent too: the thing track has no *whose* step, because ADR-0030
 * gives it six steps and none of them is that one.
 */
export function toThingCreate(draft: ThingDraft): z.input<typeof thingCreateSchema> {
  const fields = fieldsFor(draft.kind)
  const price = priceOf(draft)
  return {
    name: thingName(draft),
    kind: draft.kind === '' ? 'other' : draft.kind,
    brand: fields.lead.isMake ? blankToNull(draft.lead) : null,
    model: blankToNull(draft.model),
    serial: blankToNull(draft.serial),
    purchased_on: blankToNull(draft.purchasedOn),
    price,
    // `price` and `currency` move together — one cannot be set without the other.
    currency: price === null ? null : CAPTURE_CURRENCY,
    warranty_ends_on: coverEndsOn(draft),
    notes: null,
  }
}

/**
 * The record's name. **The lead field, plus the model when the lead is a make.**
 *
 * "Volkswagen" is not the name of a thing you own and "Gold chain" is — see `isMake` on
 * `THING_FIELDS`. Trimmed and re-joined rather than concatenated blindly, so a skipped model does not
 * leave a trailing space in the one field the record is listed and searched by.
 */
export function thingName(draft: ThingDraft): string {
  const lead = draft.lead.trim()
  const model = draft.model.trim()
  if (!fieldsFor(draft.kind).lead.isMake) return lead
  return [lead, model].filter((part) => part !== '').join(' ')
}

/**
 * The price as a decimal string, or `null`.
 *
 * Grouping and currency marks are stripped rather than rejected: `₹1,149` and `1149` are the same
 * number, and a field that refused the first would be a validation error on a value typed the way it
 * is printed. What is left is handed to `decimalStringSchema`, which owns the actual rule
 * (conventions/data.md §4 — money is never a float, so this stays a string end to end).
 */
export function priceOf(draft: ThingDraft): string | null {
  const digits = draft.price.replace(/[^\d.]/g, '')
  return digits === '' ? null : digits
}

/**
 * When cover ends: the purchase date plus the chosen length, or the date typed by hand.
 *
 * **Nothing is ever derived from today.** A dishwasher bought three years ago with a two-year
 * warranty would come out covered until 2028 if `today` stood in for a missing purchase date, which is
 * a fabricated date in the one column the cover ladder reads. So when there is no purchase date the
 * length cannot be applied and the wizard asks for the end date instead (`coverEndsOn` on the draft).
 *
 * `0` months is the answer "No cover" and yields `null` — which things.md §3 calls a normal state and
 * not a gap.
 */
export function coverEndsOn(draft: ThingDraft): string | null {
  const purchased = blankToNull(draft.purchasedOn)
  const months = draft.coverMonths
  if (months === null || months === 0 || purchased === null) return blankToNull(draft.coverEndsOn)
  return addMonths(purchased, months)
}

/**
 * A calendar date, `months` later, clamped to the end of the target month.
 *
 * All arithmetic in UTC and the result sliced back to `YYYY-MM-DD`: the whole domain is calendar dates
 * with no time, and `new Date('2026-07-30')` parsed as local time is how a date drifts a day west of
 * Greenwich (the bug `formatDate` in `ExpiryStatus.tsx` carries the same note about).
 *
 * The clamp is why this is not one `Date.UTC` call: 31 January plus one month is 3 March by rollover,
 * and a warranty that ends two days after the month it should is a date nobody typed.
 */
export function addMonths(isoDate: string, months: number): string {
  const parts = isoDate.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return isoDate

  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

// ── The saved step's readback ────────────────────────────────────────────────

export type SavedFact = { key: string; value: string; mono?: boolean }

/**
 * What the record holds, in the order it was asked for.
 *
 * ADR-0030: *"A confirmation that only says 'Saved' makes a person reopen the record to find out
 * whether the number went in."* So the number is read back — **as its mask**, not its value. The full
 * identifier is stored in plaintext (ADR-0026) and the mask is the display form everywhere else in the
 * app; a confirmation screen is a poor place to be the one exception.
 */
export function savedFacts(
  track: CaptureTrack,
  document: DocumentDraft,
  thing: ThingDraft,
): SavedFact[] {
  const facts: SavedFact[] = []

  if (track === 'thing') {
    const fields = fieldsFor(thing.kind)
    if (thing.kind !== '') facts.push({ key: 'Kind', value: KIND_LABELS[thing.kind] })
    if (thing.lead.trim() !== '') facts.push({ key: fields.lead.label, value: thing.lead.trim() })
    if (fields.model !== null && thing.model.trim() !== '') {
      facts.push({ key: fields.model.label, value: thing.model.trim() })
    }
    if (thing.serial.trim() !== '') {
      facts.push({
        key: SERIAL_LABELS[thing.kind === '' ? 'other' : thing.kind],
        value: mask(thing.serial),
        mono: true,
      })
    }
    // `formatDate`, not the raw ISO string. The readback is prose a person checks against the thing
    // in their hand, and `2029-06-14` is the machine's spelling of a date rather than a person's.
    if (thing.purchasedOn !== '') {
      facts.push({ key: 'Bought', value: formatDate(thing.purchasedOn) })
    }
    const price = priceOf(thing)
    if (price !== null) facts.push({ key: 'Paid', value: `${price} ${CAPTURE_CURRENCY}` })
    const cover = coverEndsOn(thing)
    if (cover !== null) facts.push({ key: 'Cover ends', value: formatDate(cover) })
    // "No cover" is an ANSWER, so it is read back. Saying nothing would make an answered step look
    // skipped, which is the confusion this whole screen exists to remove.
    else if (thing.coverMonths === 0) facts.push({ key: 'Cover', value: 'None' })
    return facts
  }

  if (document.preset !== '') facts.push({ key: 'Document', value: document.preset })
  else if (document.docType !== 'other') {
    facts.push({ key: 'Type', value: TYPE_WORDS[document.docType] ?? document.docType })
  }
  // "Mine" is the ONLY place the owner is named, and it is a readback rather than a badge — `holder`
  // is `null` and drawn as absence everywhere else (documents.md §4 rule 13).
  facts.push({ key: 'Whose', value: document.holder.trim() === '' ? 'Mine' : document.holder.trim() })
  if (document.title.trim() !== '') facts.push({ key: 'Title', value: document.title.trim() })
  if (document.identifier.trim() !== '') {
    facts.push({
      key: presetByName(document.preset)?.numLabel ?? 'Number',
      value: mask(document.identifier),
      mono: true,
    })
  }
  if (document.expiresOn !== '') {
    facts.push({ key: 'Expires', value: formatDate(document.expiresOn) })
  }
  return facts
}

const TYPE_WORDS: Record<string, string> = {
  identity: 'Identity',
  financial: 'Financial',
  legal: 'Legal',
  warranty: 'Warranty',
  receipt: 'Receipt',
  certificate: 'Certificate',
  other: 'Other',
}

/** The display form — the last four, as everywhere else. ADR-0026: the mask is not a boundary. */
function mask(value: string): string {
  return `•••• ${significant(value).slice(-4)}`
}

/**
 * One sentence naming what is still blank, or `''` when nothing is.
 *
 * ADR-0030 quotes it as *"Still blank: number, type. Add any of it later — the record works
 * without."* — and the second half is not decoration: a list of gaps with no reassurance reads as a
 * list of errors, which is exactly the pressure Q2 was answered to avoid.
 *
 * **An expiry date is a gap only when the document usually has one.** Q1 settled that a document
 * without an expiry is a normal silent case rather than missing data, so nagging about the expiry of
 * an Aadhaar — which never expires — would be the app inventing an obligation. The preset knows
 * (`preset.expires`), so it is asked.
 */
export function savedGaps(
  track: CaptureTrack,
  document: DocumentDraft,
  thing: ThingDraft,
): string {
  const gaps: string[] = []

  if (track === 'thing') {
    if (thing.purchasedOn === '') gaps.push('purchase date')
    if (priceOf(thing) === null) gaps.push('price')
    if (coverEndsOn(thing) === null && thing.coverMonths !== 0) gaps.push('warranty')
    if (thing.serial.trim() === '' && thing.kind === 'vehicle') gaps.push('registration')
  } else {
    if (document.identifier.trim() === '') gaps.push('number')
    if (document.preset === '' && document.docType === 'other') gaps.push('type')
    if (document.expiresOn === '' && presetByName(document.preset)?.expires === true) {
      gaps.push('expiry date')
    }
  }

  if (gaps.length === 0) return ''
  return `Still blank: ${gaps.join(', ')}. Add any of it later — the record works without.`
}
