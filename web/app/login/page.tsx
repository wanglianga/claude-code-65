'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api, saveSession } from '../lib'
import { ErrorBox } from '../components'

const DEMO_ACCOUNTS = [
  ['resident01', 'resident123', '居民（张大山）'],
  ['resident02', 'resident123', '居民（刘桂芳）'],
  ['staff01', 'staff123', '社区工作人员（王秀英）'],
  ['lawyer01', 'lawyer123', '值班律师（陈明远）'],
  ['lawyer02', 'lawyer123', '值班律师（赵婉婷）'],
  ['judicial01', 'judicial123', '司法所（孙立人）'],
  ['volunteer01', 'volunteer123', '志愿者（周晓燕）'],
  ['admin', 'admin123', '平台管理员'],
]

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      saveSession(data.token, data.user)
      router.push('/cases')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <h1>⚖️ 社区法律援助预约与案件分流平台</h1>
        <p>面向社区居民的一站式公共法律服务入口：在线咨询提交、资格初审、案件分流、律师预约、多角色协同办理与结案归档。</p>
        <ul>
          <li>劳动纠纷 / 婚姻家事 / 房屋租赁 / 邻里侵权 / 消费维权 / 行政复议</li>
          <li>法律援助 / 人民调解 / 司法所转介 / 热线解答 / 商业律师 分流</li>
          <li>欠薪群体、家庭暴力、老人赡养、未成年人权益案件特殊规则</li>
          <li>居民、社区、律师、司法所、志愿者同一服务单协同推进</li>
        </ul>
      </div>
      <div className="card">
        <h2>登录</h2>
        <form onSubmit={submit}>
          <label className="label">用户名</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" required />
          <label className="label">密码</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" required />
          <ErrorBox error={error} />
          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? '登录中…' : '登 录'}
            </button>
          </div>
        </form>
        <h3 className="mt16">演示账号（点击填入）</h3>
        <table className="accounts" style={{ width: '100%' }}>
          <tbody>
            {DEMO_ACCOUNTS.map(([u, p, label]) => (
              <tr key={u} style={{ cursor: 'pointer' }} onClick={() => { setUsername(u); setPassword(p) }}>
                <td>{label}</td>
                <td className="muted">{u} / {p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
