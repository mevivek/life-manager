import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './sheet'

/**
 * The bottom sheet's four dialog behaviours.
 *
 * `Sheet` is hand-rolled rather than `@radix-ui/react-dialog` (see its own note), and the trade for
 * that is these tests: the behaviours a dialog library would give for free are exactly the ones
 * nobody notices are missing until a keyboard user is stuck inside a form they cannot leave.
 */

function Fixture({ onClose = vi.fn() }: { onClose?: () => void }) {
  return (
    <Sheet open onClose={onClose} labelledBy="heading">
      <h2 id="heading">Add a document</h2>
      <input aria-label="Title" />
      <button type="button">Save</button>
    </Sheet>
  )
}

describe('Sheet', () => {
  it('renders nothing at all when closed', () => {
    render(
      <Sheet open={false} onClose={vi.fn()}>
        <p>hidden</p>
      </Sheet>,
    )
    // Not merely hidden with CSS: a `display: none` panel still holds focusable children, which the
    // tab order would walk through invisibly.
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })

  it('is a modal dialog named by its own heading', () => {
    render(<Fixture />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Add a document')
  })

  it('focuses the first field on open, which is what the capture budget depends on', async () => {
    render(<Fixture />)
    // ADR-0025 §5: "the field is focused before the user decides anything, and the keyboard is already
    // up." Without this the sheet costs an extra tap on every single capture.
    expect(screen.getByLabelText('Title')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Fixture onClose={onClose} />)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the panel', async () => {
    render(<Fixture />)

    // Title → Save, then Tab must wrap back to Title rather than escaping to the page behind — where
    // the tab bar and the whole document list are still in the tab order.
    expect(screen.getByLabelText('Title')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByLabelText('Title')).toHaveFocus()
  })

  it('wraps backwards too', async () => {
    render(<Fixture />)

    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })

  it('locks the page behind, and unlocks it on close', () => {
    const { unmount } = render(<Fixture />)
    // Without this, scrolling inside the sheet chains to the document once it hits its end: the sheet
    // stays put and the screen underneath slides, which reads as a bug.
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('hands focus back to whatever opened it', async () => {
    /** A real open/close cycle, because the restore reads focus captured at OPEN time. */
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Add
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} labelledBy="heading">
            <h2 id="heading">Add a document</h2>
            <input aria-label="Title" />
          </Sheet>
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Add' })

    await userEvent.click(opener)
    expect(screen.getByLabelText('Title')).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    // Focus returning to nowhere drops a keyboard user at the top of the document after every save,
    // with no indication of where they were.
    expect(opener).toHaveFocus()
  })

  it('closes when the backdrop is pressed', async () => {
    const onClose = vi.fn()
    render(<Fixture onClose={onClose} />)

    // The backdrop is the dialog's parent element. `pointer: null` because it is decoration with no
    // role — `userEvent` otherwise refuses to click an element it considers non-interactive.
    const backdrop = screen.getByRole('dialog').parentElement
    expect(backdrop).not.toBeNull()
    if (backdrop !== null) await userEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when the press lands inside the panel', async () => {
    const onClose = vi.fn()
    render(<Fixture onClose={onClose} />)

    // The handler is `onMouseDown` checked against `currentTarget`. A naive `onClick` on the wrapper
    // would close for any drag that *ends* on the backdrop — discarding whatever was being typed.
    await userEvent.click(screen.getByLabelText('Title'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
