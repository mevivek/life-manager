import type { DocumentFile } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { DocumentFiles } from './DocumentFiles'

/**
 * The scans strip's one new behaviour: an image opens in the app's own viewer.
 *
 * The rest of this component (the upload path, the three rejection sentences) is unchanged and untested
 * here. What is worth locking down is the **presign discipline**, because getting it wrong is invisible:
 * a signed R2 URL turned into a `useQuery` would be written to IndexedDB by `persister.ts` and nothing
 * on screen would look any different (security-model.md §6).
 */

const DOC_ID = '00000001-0000-4000-8000-000000000000'

const file = (overrides: Partial<DocumentFile> & { id: string }): DocumentFile => ({
  document_id: DOC_ID,
  version: 1,
  mime: 'image/jpeg',
  size_bytes: 120_000,
  // `documentFileSchema` has this non-nullable, so a fixture with `null` fails the client's Zod parse.
  sha256: 'a'.repeat(64),
  is_primary: true,
  uploaded_at: '2026-07-01T00:00:00.000Z',
  created_at: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

function renderFiles(files: DocumentFile[]) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <DocumentFiles documentId={DOC_ID} files={files} />
    </QueryClientProvider>,
  )
}

describe('DocumentFiles and the photo viewer', () => {
  it('mints the URL on the tap and opens the viewer, never before', async () => {
    let presigns = 0
    server.use(
      http.post(`*/api/v1/documents/${DOC_ID}/files:presign-download`, () => {
        presigns += 1
        return HttpResponse.json({
          download_url: 'https://r2.example.test/fake-signed',
          expires_at: '2026-07-30T12:05:00.000Z',
        })
      }),
    )

    renderFiles([file({ id: 'f1', version: 2 })])

    /**
     * Zero presigns on render, and that is the whole reason the comp's thumbnail strip is not built.
     * `onUnhandledRequest: 'error'` would not catch this — the handler above exists — so the counter is
     * the assertion.
     */
    expect(presigns).toBe(0)
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'View version 2' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(presigns).toBe(1)
    // The viewer is named by the version it is showing, and shows the image it just signed for.
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Version 2')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://r2.example.test/fake-signed')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    // Unmounting is what drops the signed URL — it lives in this component's state and nowhere else.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('leaves a PDF to the OS, because we are not writing a PDF reader', async () => {
    renderFiles([file({ id: 'f1', version: 1, mime: 'application/pdf' })])

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    // One button, not two: the actions already wrap onto their own line at 390px, and a fourth control
    // is what clipped "Version 1" to "Versi…" the first time.
    expect(screen.queryByRole('button', { name: /^View/ })).toBeNull()
  })

  it('says so on the row’s own terms when the presign fails, and opens nothing', async () => {
    server.use(
      http.post(`*/api/v1/documents/${DOC_ID}/files:presign-download`, () =>
        HttpResponse.json(
          {
            type: 'https://life-manager.app/problems/not-found',
            title: 'Not Found',
            status: 404,
            detail: 'That scan is no longer here.',
          },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )

    renderFiles([file({ id: 'f1', version: 1 })])
    await userEvent.click(screen.getByRole('button', { name: 'View version 1' }))

    // Not swallowed, and not drawn as "this file has a problem" either — the file is fine, the presign
    // was not.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/no longer here/i)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
