// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ConfirmHost, { confirmDialog } from './Confirm'

afterEach(cleanup)

describe('confirmDialog + ConfirmHost', () => {
  it('resolves false with NO host mounted (fail-safe: never delete without an explicit yes)', async () => {
    await expect(confirmDialog({ title: 'Delete?', message: 'gone forever' })).resolves.toBe(false)
  })

  it('resolves true only when the confirm button is clicked', async () => {
    render(<ConfirmHost />)
    const p = confirmDialog({ title: 'Delete video?', message: 'This is permanent.', confirmLabel: 'Delete', danger: true })
    expect(await screen.findByText('Delete video?')).toBeTruthy()
    fireEvent.click(screen.getByText('Delete'))
    await expect(p).resolves.toBe(true)
  })

  it('resolves false on cancel', async () => {
    render(<ConfirmHost />)
    const p = confirmDialog({ title: 'Clear tab?', message: 'Everything typed here will be lost.' })
    expect(await screen.findByText('Clear tab?')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    await expect(p).resolves.toBe(false)
  })
})
