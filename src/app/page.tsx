import { redirect } from 'next/navigation'

// Root path redirects to the protected dashboard.
// Unauthenticated users are caught by middleware first.
export default function RootPage() {
  redirect('/dashboard')
}
