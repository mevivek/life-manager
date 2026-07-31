import { documentTypeSchema, HOLDER_MINE } from '@life-manager/shared'
import { Card } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The archive's search field and filter chip row. ADR-0025 §7.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Every chip maps to a real query parameter. None of them is a mock.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `q` · `type` · `tag` · `expiring_before` · `has_file` — the whole of `documentListQuerySchema`'s
 * filter surface, filtered **server-side**. The design comp hard-coded two of these (its Tag chip
 * always meant `#home`, its date chip always meant 1 Jan 2027) because a prototype only has to look
 * right; both are real controls here.
 *
 * Two of them needed a picker the comp did not draw, and its own "second pass" note lists the date
 * one as still-to-draw. They are built in the system's idiom rather than invented:
 *
 *  - **Tag** unfolds into a wrapping row of the tags that actually exist in the loaded page — the
 *    same pill row the type filter uses. A free-text tag box would let you filter by a tag you do not
 *    have and get a confidently empty list.
 *  - **Expires before** unfolds into a native `<input type="date">`. This is the one place a native
 *    control beats a pill row, because the value is unbounded — and it is the same control the form
 *    uses for the same job, so the OS date picker is already familiar from capture.
 *
 * ── Why no dropdowns ──
 *
 * Seven document types is a wrapping row of pills. A native `<select>` on a 390px screen opens an OS
 * sheet that is *worse* than the options already being visible. The previous `DocumentList` used one,
 * and replacing it is the biggest interaction change in the redesign.
 */

export type Filters = {
  q: string
  type: string
  tag: string
  before: string
  /** `''` unset · `yes` has a scan · `no` no scan. */
  scan: '' | 'yes' | 'no'
  /**
   * `''` unset · `mine` the owner's own · any other string an exact holder.
   *
   * `mine` is a sentinel and matches `HOLDER_MINE` on the wire — the collision risk (someone filing a
   * document under the literal name "mine") is accepted in `documentListQuerySchema`, where it is
   * argued.
   */
  who: string
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  type: '',
  tag: '',
  before: '',
  scan: '',
  who: '',
}

export function hasAnyFilter(filters: Filters): boolean {
  return (
    filters.q !== '' ||
    filters.type !== '' ||
    filters.tag !== '' ||
    filters.before !== '' ||
    filters.scan !== '' ||
    filters.who !== ''
  )
}

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  financial: 'Financial',
  legal: 'Legal',
  warranty: 'Warranty',
  receipt: 'Receipt',
  certificate: 'Certificate',
  other: 'Other',
}

/** Which sub-panel is unfolded. Only ever one — two open panels push the list off the screen. */
type OpenPanel = 'none' | 'type' | 'tag' | 'before' | 'who'

export function DocumentFilters({
  filters,
  onChange,
  /** Tags present in the loaded page, so the tag filter offers only tags that exist. */
  availableTags,
  openPanel,
  people,
  onOpenPanel,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  availableTags: string[]
  openPanel: OpenPanel
  /** Holder names that exist in the archive. Empty means the Whose chip is not drawn at all. */
  people: string[]
  onOpenPanel: (panel: OpenPanel) => void
}) {
  function toggle(panel: Exclude<OpenPanel, 'none'>) {
    onOpenPanel(openPanel === panel ? 'none' : panel)
  }

  return (
    <>
      {/*
        ── The search field used to be here, and it is now the library header's ──

        [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md) merges Documents and Things into
        one screen with a scope switch, so a search box owned by the *document* filters could only ever
        search one of the three scopes. `LibrarySearch` owns it now: one field, above the scope pills,
        searching whatever scope is showing.

        `filters.q` is still part of this type and still drives `hasAnyFilter`, because it is still a
        filter — it is just no longer typed into here.
      */}

      {/*
        A horizontally scrolling chip row. `overflow-x-auto` with `shrink-0` chips rather than wrapping
        — four filters that wrap onto two lines push the first row of results below the fold on a
        390px screen, and the filter row is not the content.
      */}
      <div className="-mx-gutter mt-3 flex gap-[7px] overflow-x-auto px-gutter pb-0.5">
        <Chip
          size="sm"
          selected={filters.type !== ''}
          aria-expanded={openPanel === 'type'}
          onClick={() => toggle('type')}
        >
          {filters.type === '' ? 'Type' : (TYPE_LABELS[filters.type] ?? filters.type)}
        </Chip>
        <Chip
          size="sm"
          selected={filters.tag !== ''}
          aria-expanded={openPanel === 'tag'}
          // With no tags anywhere in the archive there is nothing to offer, so the control would open
          // an empty panel. Disabled is honest; hiding it would make the row's contents shift about.
          disabled={availableTags.length === 0 && filters.tag === ''}
          onClick={() => toggle('tag')}
        >
          {filters.tag === '' ? 'Tag' : `#${filters.tag}`}
        </Chip>
        {/*
          Whose — a panel, not a cycle. Scan cycles because it has three fixed states; "who" has as
          many states as there are people, so it opens the same kind of list the tag filter does.

          Drawn only once a holder EXISTS. Before that it would be a control that can only filter to
          "Mine", which is every document — the same "draw it the day the thing exists" rule as the
          domain switcher (ADR-0025 §4) and the archive's Show-numbers toggle.
        */}
        {people.length > 0 && (
          <Chip
            size="sm"
            selected={filters.who !== ''}
            aria-expanded={openPanel === 'who'}
            onClick={() => toggle('who')}
          >
            {filters.who === '' ? 'Whose' : filters.who === HOLDER_MINE ? 'Mine' : filters.who}
          </Chip>
        )}
        <Chip
          size="sm"
          selected={filters.before !== ''}
          aria-expanded={openPanel === 'before'}
          onClick={() => toggle('before')}
        >
          {filters.before === '' ? 'Expires before' : `Before ${filters.before}`}
        </Chip>
        {/*
          Scan cycles unset → no scan → has a scan → unset, rather than unfolding a panel. Three
          states on one chip is legible where three chips would not be, and "no scan" is the one
          anybody actually wants — it is the job the Now screen's nudge links to.
        */}
        <Chip
          size="sm"
          selected={filters.scan !== ''}
          onClick={() =>
            onChange({
              ...filters,
              scan: filters.scan === '' ? 'no' : filters.scan === 'no' ? 'yes' : '',
            })
          }
        >
          {filters.scan === 'no' ? 'No scan' : filters.scan === 'yes' ? 'Has a scan' : 'Scan'}
        </Chip>
      </div>

      {openPanel === 'type' && (
        <Card className="mt-2.5 flex flex-wrap gap-1.5 p-2">
          {documentTypeSchema.options.map((option) => (
            <Chip
              key={option}
              size="sm"
              selected={filters.type === option}
              onClick={() => {
                onChange({ ...filters, type: filters.type === option ? '' : option })
                onOpenPanel('none')
              }}
            >
              {TYPE_LABELS[option] ?? option}
            </Chip>
          ))}
        </Card>
      )}

      {openPanel === 'tag' && (
        <Card className="mt-2.5 flex flex-wrap gap-1.5 p-2">
          {availableTags.map((tag) => (
            <Chip
              key={tag}
              size="sm"
              selected={filters.tag === tag}
              onClick={() => {
                onChange({ ...filters, tag: filters.tag === tag ? '' : tag })
                onOpenPanel('none')
              }}
            >
              #{tag}
            </Chip>
          ))}
        </Card>
      )}

      {openPanel === 'who' && (
        <Card className="mt-2.5 flex flex-wrap gap-1.5 p-2">
          <Chip
            size="sm"
            selected={filters.who === HOLDER_MINE}
            onClick={() => {
              onChange({ ...filters, who: filters.who === HOLDER_MINE ? '' : HOLDER_MINE })
              onOpenPanel('none')
            }}
          >
            Mine
          </Chip>
          {people.map((person) => (
            <Chip
              key={person}
              size="sm"
              selected={filters.who === person}
              onClick={() => {
                onChange({ ...filters, who: filters.who === person ? '' : person })
                onOpenPanel('none')
              }}
            >
              {person}
            </Chip>
          ))}
        </Card>
      )}

      {openPanel === 'before' && (
        <Card className="mt-2.5 flex flex-col gap-1.5 p-3">
          <Label htmlFor="filter-before">Expires before</Label>
          <Input
            id="filter-before"
            type="date"
            value={filters.before}
            className="px-3"
            onChange={(event) => onChange({ ...filters, before: event.target.value })}
          />
          <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
            {/*
              Q1's answer, stated where it will actually be noticed. `?expiring_before=` is an upper
              bound on a date, and a document with no date is not "before" anything — so this filter
              silently excludes undated documents. Saying so beats letting the user conclude they lost
              some.
            */}
            Documents with no expiry date are not included — there is no date to compare.
          </p>
        </Card>
      )}
    </>
  )
}
