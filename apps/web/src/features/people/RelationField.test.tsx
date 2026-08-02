import { RELATION_SUGGESTIONS } from '@life-manager/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { RelationField } from './RelationField'

/**
 * The relation field, and **the reason it exists as a component at all**.
 *
 * Three screens ask for a relation — the person sheet, the capture wizard's Whose step, and the full
 * document form — and only the first offered the answers. The other two, which are the ones a user
 * meets while actually filing something, were a bare `<Input placeholder="Wife">`. That is the same
 * drift as the row builder earlier in this session, so it gets the same fix and the same kind of
 * test: one component, and an assertion that every surface uses it.
 *
 * `CaptureSheet.test.tsx` and `documents.test.tsx` cover their own screens; the cross-surface
 * assertion lives here because the claim is about all three at once.
 */

/** A controlled harness, because the field is controlled and an uncontrolled render tests nothing. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <RelationField id="relation" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('the relation field offers the premade relations', () => {
  it('draws every suggestion as a visible control, not behind a menu', async () => {
    render(<Harness />)

    // Every one of them, on screen, without opening anything — the list is walked rather than
    // counted, so adding a relation cannot make this test stale. design.md §6's no-dropdowns rule
    // turns on exactly this: the options fit, so hiding them behind a tap would cost a tap and hide
    // them.
    for (const suggestion of RELATION_SUGGESTIONS) {
      expect(screen.getByRole('button', { name: suggestion })).toBeInTheDocument()
    }
    expect(RELATION_SUGGESTIONS.length).toBeGreaterThan(0)

    // And nothing is a `<select>`, which is the shape this deliberately is not.
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('fills the field when a suggestion is tapped', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Wife' }))

    expect(screen.getByTestId('value')).toHaveTextContent('Wife')
    expect(screen.getByLabelText('Relation')).toHaveValue('Wife')
  })

  it('clears on a second tap, so a mistake does not need the text field to undo', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Wife" />)

    await user.click(screen.getByRole('button', { name: 'Wife' }))

    expect(screen.getByTestId('value')).toHaveTextContent('')
  })

  it('still takes free text, because the list is suggestions and not an enum', async () => {
    // The promise `packages/shared/src/people.ts` makes on the wire, kept on screen: "Flatmate" is a
    // real answer and a closed list would make the app argue with its user about their household.
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('Relation'), 'Flatmate')

    expect(screen.getByTestId('value')).toHaveTextContent('Flatmate')
    // And no chip claims to be selected for a value that is not one of them.
    for (const suggestion of RELATION_SUGGESTIONS) {
      expect(screen.getByRole('button', { name: suggestion })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
  })

  it('offers examples the chips do not already offer', () => {
    // "Or type it — …" exists to say *the list above is a shortcut, not the choices*. An example
    // that is already a pill two rows up says the opposite. The first 390px render shipped
    // "Mother", which is a chip; this is the assertion that stops it coming back.
    render(<Harness />)

    const placeholder = screen.getByLabelText('Relation').getAttribute('placeholder') ?? ''
    const examples =
      placeholder
        .split('—')[1]
        ?.split(',')
        .map((part) => part.trim()) ?? []

    expect(examples.length).toBeGreaterThan(1)
    for (const example of examples) {
      expect(
        RELATION_SUGGESTIONS as readonly string[],
        `"${example}" is already a chip`,
      ).not.toContain(example)
    }
  })

  it('marks the matching chip as pressed, so the state is announced not just tinted', () => {
    render(<Harness initial="Son" />)

    expect(screen.getByRole('button', { name: 'Son' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Wife' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('every surface that asks for a relation uses it', () => {
  /*
    A source-text assertion, and it is the only kind that can make this claim: the three screens are
    in three different suites with three different harnesses, and the regression being prevented is
    "someone adds a fourth relation input" — which no rendering test would notice, because a screen
    nobody wrote a test for is a screen with no test.
  */
  const surfaces = {
    'features/people/PersonSheet.tsx': import.meta.glob('./PersonSheet.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
    'features/documents/CaptureSheet.tsx': import.meta.glob('../documents/CaptureSheet.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
    'features/documents/DocumentForm.tsx': import.meta.glob('../documents/DocumentForm.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  }

  for (const [name, loaded] of Object.entries(surfaces)) {
    it(`${name} renders RelationField rather than a bare input`, () => {
      const source = Object.values(loaded)[0] as string

      expect(source, `${name} does not use RelationField`).toContain('<RelationField')
      // The exact shape that used to be there, in all three files at once.
      expect(source, `${name} still has a bare relation input`).not.toMatch(
        /<Input[^>]*id=["']?(capture-)?relation["']?/,
      )
    })
  }
})
