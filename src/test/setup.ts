import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import 'fake-indexeddb/auto'
import { afterEach } from 'vitest'

// Testing Library only auto-unmounts when Vitest globals are on; we use explicit imports.
afterEach(cleanup)

// jsdom doesn't implement scrolling; the router's scroll restoration calls it.
window.scrollTo = () => {}
