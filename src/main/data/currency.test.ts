import { describe, it, expect } from 'vitest'
import { goldPkrPerTola } from './currency'

describe('goldPkrPerTola', () => {
  it('converts USD/oz (via 1/xau) and USD/PKR to PKR per tola', () => {
    // usdXau = 0.0005 → USD/oz = 2000; usdPkr = 280.
    // (2000 * 280 * 11.6638038) / 31.1034768 = 210000 exactly.
    expect(goldPkrPerTola(0.0005, 280)).toBeCloseTo(210000, 2)
  })
  it('scales linearly with the PKR rate', () => {
    expect(goldPkrPerTola(0.0005, 560)).toBeCloseTo(420000, 2)
  })
})
