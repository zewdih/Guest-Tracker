import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { MANAGER_EMAIL } from './config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // { display_name, role }
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Load (or create) the signed-in user's profile row.
  useEffect(() => {
    if (!session?.user) { setProfile(null); setProfileLoading(false); return }
    let cancelled = false
    setProfileLoading(true)

    async function loadProfile() {
      const user = session.user
      let { data } = await supabase
        .from('profiles')
        .select('display_name, role')
        .eq('id', user.id)
        .maybeSingle()

      if (!data && !cancelled) {
        // First sign-in: create a member profile using their email name.
        const guessName = user.email?.split('@')[0] || 'Member'
        await supabase.from('profiles').insert({ id: user.id, display_name: guessName })
        // The database trigger auto-promotes the manager email. Re-fetch to get the actual role.
        const { data: fresh } = await supabase
          .from('profiles').select('display_name, role').eq('id', user.id).maybeSingle()
        data = fresh || { display_name: guessName, role: 'member' }
      }
      if (!cancelled) {
        setProfile(data)
        setProfileLoading(false)
      }
    }
    loadProfile()
    return () => { cancelled = true }
  }, [session])

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
