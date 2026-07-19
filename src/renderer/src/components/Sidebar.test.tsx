// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from './Sidebar'

afterEach(cleanup)

describe('Sidebar', () => {
  it('renders the gold build badge with the injected BUILD_TAG', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    // The badge is the deploy-verification mechanism — if this ever stops rendering,
    // stale-build detection is silently gone. Guard it with a test.
    expect(screen.getByText('v0.0.0-test · 2026-01-01 00:00 · testtag')).toBeTruthy()
  })

  it('renders the app name and every nav destination', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(screen.getByText('NIHILPOINTZERO')).toBeTruthy()
    for (const label of ['Video Studio', '🎞 Storyboard Director', '🎥 Presenter Studio', '✂ Timeline Editor', 'Settings']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })
})
