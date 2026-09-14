'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { getUser } from './lib'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    const user = getUser()
    router.replace(user ? '/cases' : '/login')
  }, [router])
  return <div className="empty">正在进入平台…</div>
}
