import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router'
import { AppLayout } from './components/AppLayout'
import { LibraryHome } from './pages/LibraryHome'
import { NotFound } from './pages/NotFound'
import { SnippetPage } from './pages/SnippetPage'

const rootRoute = createRootRoute({
  component: AppLayout,
  notFoundComponent: () => <NotFound />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LibraryHome,
})

const snippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/s/$snippetId',
  component: SnippetPage,
})

export const routeTree = rootRoute.addChildren([indexRoute, snippetRoute])

export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({ routeTree, ...options })
}

export const router = createAppRouter()

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
