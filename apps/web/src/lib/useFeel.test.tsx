import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { FEEL_STORAGE_KEYS } from './feel'
import { FeelProvider, useFeel } from './useFeel'

/**
 * The context, not the storage. `feel.test.ts` covers `readFeel`/`storeFeel`/`applyFeel`; this covers
 * the thing a context buys over a bare hook — that a control setting the preference in one place and
 * a sentence reading it in another see the **same** value, without depending on whether the router
 * kept the second one mounted.
 */

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.face
})

/** A setter and a reader, deliberately as two separate consumers of the one provider. */
function Harness() {
  return (
    <FeelProvider>
      <Setter />
      <Reader />
    </FeelProvider>
  )
}

function Setter() {
  const { set } = useFeel()
  return (
    <div>
      <button type="button" onClick={() => set('voice', 'plain')}>
        go plain
      </button>
      <button type="button" onClick={() => set('density', 'compact')}>
        go compact
      </button>
    </div>
  )
}

function Reader() {
  const { copy, feel } = useFeel()
  return (
    <div>
      <p data-testid="headline">{copy.nowHeadline(1, 3)}</p>
      <p data-testid="density">{feel.density}</p>
    </div>
  )
}

describe('FeelProvider', () => {
  it('lets a setter in one subtree change a reader in another', async () => {
    render(<Harness />)
    // Warm by default — the sentence, not the terse form.
    expect(screen.getByTestId('headline')).toHaveTextContent('One thing needs you.')

    await userEvent.click(screen.getByRole('button', { name: 'go plain' }))
    // The reader, a sibling of the setter, sees the new register. A two-`useState` design would only
    // pass this if React happened to keep both mounted.
    expect(screen.getByTestId('headline')).toHaveTextContent('1 item due')
    expect(localStorage.getItem(FEEL_STORAGE_KEYS.voice)).toBe('plain')
  })

  it('stamps density onto <html> so the CSS token swap takes effect', async () => {
    render(<Harness />)
    // Mount stamps the default, which is what makes the pre-paint bootstrap optional.
    expect(document.documentElement.dataset.density).toBe('generous')

    await userEvent.click(screen.getByRole('button', { name: 'go compact' }))
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(screen.getByTestId('density')).toHaveTextContent('compact')
  })

  it('falls back to warm defaults when used with no provider around it', () => {
    // The deliberate no-throw: a dozen component tests render a bare component and read one sentence.
    render(<Reader />)
    expect(screen.getByTestId('headline')).toHaveTextContent('One thing needs you.')
  })
})
