import { AuthForm } from '@/components/auth-form'

export const metadata = { title: 'Sign in · SCENELAB' }

// searchParams is read here rather than with useSearchParams in the form, which would force
// a client bailout and need a Suspense boundary for no benefit — the value is known at
// request time.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const { error } = await searchParams
  return <AuthForm mode="sign-in" errorCode={Array.isArray(error) ? error[0] : error} />
}
