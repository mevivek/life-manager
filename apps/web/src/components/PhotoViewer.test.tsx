import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PhotoViewer } from './PhotoViewer'

/**
 * The viewer's dialog behaviours.
 *
 * The comp draws a click-anywhere-to-close `<div>` with no role, no Escape and no focus management, so
 * every one of these is something we add rather than something we preserve (design.md §9). They are
 * also the behaviours that fail silently: a viewer with no Escape and no focus return looks perfect in
 * a screenshot and strands a keyboard user on a photograph.
 *
 * `src` is a plain string here rather than a data URI. jsdom never fetches it, and a presigned URL is
 * precisely the thing that must not be written down anywhere — including in a fixture.
 */
describe('PhotoViewer', () => {
  it('is a modal dialog named by the image it is showing', () => {
    render(<PhotoViewer src="/fake-scan" alt="Version 2" onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Version 2')
    // The alt text is the same string: the dialog's name says which picture, the alt says what the
    // picture is, and for a scan those are the same fact.
    expect(screen.getByRole('img')).toHaveAccessibleName('Version 2')
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={onClose} />)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the dark ground is pressed', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={onClose} />)

    // A full-screen viewer has no separate backdrop element — the dialog IS the ground, so pressing it
    // is the "tap outside the picture" gesture.
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when the image itself is pressed', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={onClose} />)

    // Pressing the thing you came to look at must not dismiss it. This is the assertion that fails if
    // someone simplifies the ground handler down to the comp's "close on any click".
    await userEvent.click(screen.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes exactly once when Close is pressed, not twice', async () => {
    const onClose = vi.fn()
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={onClose} />)

    // The button sits inside the ground, so without the header stopping propagation the press would
    // fire the button's handler AND the ground's. Harmless today and wrong the moment `onClose` does
    // anything other than flip a boolean.
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focuses Close on open, so the way out is under your thumb', () => {
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('keeps Tab inside the viewer', async () => {
    render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={vi.fn()} />)

    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    // Close is the only control, so the trap's job here is to keep focus from escaping to the document
    // list and the tab bar still sitting in the tab order behind the overlay.
    await userEvent.tab()
    expect(close).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(close).toHaveFocus()
  })

  it('locks the page behind, and unlocks it on close', () => {
    const { unmount } = render(<PhotoViewer src="/fake-scan" alt="Version 1" onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('hands focus back to whatever opened it', async () => {
    /** A real open/close cycle, because the restore reads the focus captured at MOUNT time. */
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            View
          </button>
          {open && <PhotoViewer src="/fake-scan" alt="Version 1" onClose={() => setOpen(false)} />}
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'View' })

    await userEvent.click(opener)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    // Without this a keyboard user is dropped at the top of the document after every scan they look
    // at, with no indication of where they were.
    expect(opener).toHaveFocus()
  })
})
