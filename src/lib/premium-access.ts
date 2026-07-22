export type PremiumUser = { id: string; email: string | null }
export type PremiumDeps = {
  getUser: () => Promise<PremiumUser | null>
  getStatus: (userId: string) => Promise<boolean>
  adminEmails: string[]
}

export function decidePremium(user: PremiumUser | null, active: boolean, adminEmails: string[]): boolean {
  if (!user) return false
  if (user.email && adminEmails.map((e) => e.toLowerCase().trim()).includes(user.email.toLowerCase())) return true
  return active
}

async function defaultGetUser(): Promise<PremiumUser | null> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

async function defaultGetStatus(userId: string): Promise<boolean> {
  const { getActiveStatusByUserId } = await import('@/lib/supabase/subscriptions')
  return (await getActiveStatusByUserId(userId)).active
}

function defaultAdminEmails(): string[] {
  return (process.env.COMP_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

export async function resolveRequestPremium(
  deps: Partial<PremiumDeps> = {},
): Promise<{ premium: boolean; userId: string | null; email: string | null }> {
  const getUser = deps.getUser ?? defaultGetUser
  const getStatus = deps.getStatus ?? defaultGetStatus
  const adminEmails = deps.adminEmails ?? defaultAdminEmails()

  let user: PremiumUser | null = null
  try { user = await getUser() } catch { user = null }
  if (!user) return { premium: false, userId: null, email: null }

  let active = false
  try { active = await getStatus(user.id) } catch { active = false }

  return { premium: decidePremium(user, active, adminEmails), userId: user.id, email: user.email }
}
