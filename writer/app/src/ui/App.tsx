import React, { useMemo, useState } from 'react'
import { WalletClient } from '@bandeira-tech/b3nd-sdk/wallet'
import { HttpClient } from '@bandeira-tech/b3nd-sdk'
import { AppsClient } from '@bandeira-tech/b3nd-sdk/apps'

type Config = {
  walletUrl: string
  apiBasePath: string
  backendUrl: string
  appServerUrl: string
  appApiBasePath: string
}

export function App() {
  const [cfg, setCfg] = useState<Config>({
    walletUrl: 'http://localhost:3001',
    apiBasePath: '/api/v1',
    backendUrl: 'http://localhost:8080',
    appServerUrl: 'http://localhost:3003',
    appApiBasePath: '/api/v1'
  })
  const [session, setSession] = useState<{ username: string; token: string; expiresIn: number } | null>(null)
  const [appKey, setAppKey] = useState('')
  const [appToken, setAppToken] = useState('')
  const [appSession, setAppSession] = useState('')
  const [plainUri, setPlainUri] = useState('mutable://accounts/:key/profile')
  const [encUri, setEncUri] = useState('mutable://accounts/:key/private')
  const [plainPayload, setPlainPayload] = useState('{"name":"Test User","timestamp":""}')
  const [encPayload, setEncPayload] = useState('{"secret":"Encrypted data","timestamp":""}')
  const [output, setOutput] = useState<any>(null)
  const [log, setLog] = useState<string[]>([])
  const [section, setSection] = useState<'config'|'app'|'auth'|'write'>('config')
  const [lastResolvedUri, setLastResolvedUri] = useState<string | null>(null)
  const [lastAppUri, setLastAppUri] = useState<string | null>(null)
  // App action configuration
  const [actionName, setActionName] = useState('registerForReceiveUpdates')
  const [validationFormat, setValidationFormat] = useState<'email' | ''>('email')
  const [writeKind, setWriteKind] = useState<'plain'|'encrypted'>('plain')
  const [writePlainPath, setWritePlainPath] = useState('mutable://accounts/:key/subscribers/updates/:signature')
  const [writeEncPath, setWriteEncPath] = useState('immutable://accounts/:key/subscribers/updates/:signature')
  const [actionPayload, setActionPayload] = useState('user@example.com')
  const [encPublicKeyHex, setEncPublicKeyHex] = useState('')

  const wallet = useMemo(() => new WalletClient({ walletServerUrl: cfg.walletUrl.replace(/\/$/, ''), apiBasePath: cfg.apiBasePath }), [cfg.walletUrl, cfg.apiBasePath])
  const backend = useMemo(() => new HttpClient({ url: cfg.backendUrl.replace(/\/$/, '') }), [cfg.backendUrl])
  const apps = useMemo(() => new AppsClient({ appServerUrl: cfg.appServerUrl.replace(/\/$/, ''), apiBasePath: cfg.appApiBasePath }), [cfg.appServerUrl, cfg.appApiBasePath])

  const logLine = (src: 'local' | 'apps' | 'wallet' | 'backend', m: string) => {
    const time = new Date().toLocaleTimeString()
    const tag = (src || 'local').padEnd(6, ' ').slice(0, 6)
    setLog((l) => [...l, `${time} ${tag} ${m}`])
  }

  const applyConfig = () => { logLine('local', `Config applied`) }

  const health = async () => {
    const h = await wallet.health()
    setOutput(h)
    logLine('wallet', `Health: ${h.status}`)
  }

  const serverKeys = async () => {
    const k = await wallet.getServerKeys()
    setOutput(k)
    logLine('wallet', `Server keys ok`)
  }

  const genAppKeys = async () => {
    const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const pub = await crypto.subtle.exportKey('raw', kp.publicKey)
    const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey)
    const pubHex = Array.from(new Uint8Array(pub)).map((b) => b.toString(16).padStart(2, '0')).join('')
    const privB64 = btoa(String.fromCharCode(...new Uint8Array(priv)))
    const privPem = `-----BEGIN PRIVATE KEY-----\n${(privB64.match(/.{1,64}/g) || []).join('\n')}\n-----END PRIVATE KEY-----`
    setAppKey(pubHex)
    // Generate encryption (X25519) public key so encrypted actions can be used later
    // @ts-ignore X25519 supported in runtime
    const encKp = await crypto.subtle.generateKey({ name: 'X25519', namedCurve: 'X25519' } as any, true, ['deriveBits']) as CryptoKeyPair
    const encPubRaw = await crypto.subtle.exportKey('raw', encKp.publicKey)
    const encPubHex = Array.from(new Uint8Array(encPubRaw)).map(b=>b.toString(16).padStart(2,'0')).join('')
    setEncPublicKeyHex(encPubHex)
    setOutput({ publicKeyHex: pubHex, privateKeyPem: privPem, encryptionPublicKeyHex: encPubHex })
    logLine('local', 'Generated app keys (identity + encryption)')
  }

  const registerApp = async () => {
    const act = {
      action: actionName,
      validation: validationFormat ? { stringValue: { format: validationFormat } } : undefined,
      write: writeKind === 'encrypted' ? { encrypted: writeEncPath } : { plain: writePlainPath },
    } as any
    if (writeKind === 'encrypted' && !encPublicKeyHex) {
      logLine('local', 'Missing encryption public key for encrypted action');
      setOutput({ error: 'encryptionPublicKeyHex required for encrypted actions' });
      return;
    }
    const payload: any = { appKey, accountPrivateKeyPem: (output?.privateKeyPem || ''), allowedOrigins: ['*'], actions: [act], encryptionPublicKeyHex: encPublicKeyHex };
    const res = await apps.registerApp(payload)
    setOutput(res)
    if ((res as any).token) setAppToken((res as any).token)
    logLine('apps', 'App registered')
  }

  const updateSchema = async () => {
    const act = {
      action: actionName,
      validation: validationFormat ? { stringValue: { format: validationFormat } } : undefined,
      write: writeKind === 'encrypted' ? { encrypted: writeEncPath } : { plain: writePlainPath },
    } as any
    const res = await apps.updateSchema(appKey, [act])
    setOutput(res)
    logLine('apps', 'Schema updated')
  }

  const fetchSchema = async () => {
    const res = await apps.getSchema(appKey)
    setOutput(res)
    logLine('apps', 'Schema fetched')
  }

  const createSession = async () => {
    const res = await apps.createSession(appKey, appToken)
    setAppSession(res.session)
    setOutput(res)
    logLine('apps', 'Session created')
  }

  const signup = async (username: string, password: string) => {
    const s = await wallet.signupWithToken(appToken, { username, password })
    setSession(s)
    logLine('wallet', 'Signup ok')
    setOutput(s)
  }

  const login = async (username: string, password: string) => {
    const s = await wallet.loginWithTokenSession(appToken, appSession, { username, password })
    setSession(s)
    logLine('wallet', 'Login ok')
    setOutput(s)
  }

  const myKeys = async () => {
    if (!session) throw new Error('no session')
    wallet.setSession(session)
    const k = await wallet.getPublicKeys()
    setOutput(k)
    logLine('wallet', 'My keys ok')
  }

  const writePlain = async () => {
    if (!session) throw new Error('no session')
    wallet.setSession(session)
    const pp = plainPayload.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`)
    const data = JSON.parse(pp)
    const r = await wallet.proxyWrite({ uri: plainUri, data, encrypt: false })
    setOutput(r)
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri)
    logLine('wallet', 'Write plain ok')
  }

  const writeEnc = async () => {
    if (!session) throw new Error('no session')
    wallet.setSession(session)
    const ep = encPayload.replace(/"timestamp"\s*:\s*""/, `"timestamp":"${new Date().toISOString()}"`)
    const data = JSON.parse(ep)
    const r = await wallet.proxyWrite({ uri: encUri, data, encrypt: true })
    setOutput(r)
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri)
    logLine('wallet', 'Write enc ok')
  }

  const readLast = async () => {
    const target = lastResolvedUri || lastAppUri || plainUri
    const res = await backend.read(target)
    setOutput(res)
    logLine('backend', 'Read ok')
  }

  const testAction = async () => {
    try {
      const res = await apps.invokeAction(appKey, actionName, actionPayload, window.location.origin)
      setOutput(res)
      if (res?.uri) setLastAppUri(res.uri)
      logLine('apps', `Invoked action '${actionName}'`)
    } catch (e: any) {
      logLine('apps', `Invoke failed: ${e?.message || String(e)}`)
      setOutput({ error: e?.message || String(e) })
    }
  }

  return (
    <div className="wrap">
      <div className="layout">
        <aside className="sidebar">
          <div className="card">
            <h3>Navigation</h3>
            <div className="nav" style={{ marginTop: 8 }}>
              <button onClick={() => setSection('config')}>Configuration</button>
              <button onClick={() => setSection('app')}>App</button>
              <button onClick={() => setSection('auth')}>Auth</button>
              <button onClick={() => setSection('write')}>Write</button>
            </div>
          </div>
        </aside>
        <main>
          {section === 'config' && (
            <section className="card">
              <h3>Configuration</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Wallet URL</label>
                  <input value={cfg.walletUrl} onChange={(e) => setCfg({ ...cfg, walletUrl: e.target.value })} placeholder="http://localhost:3001" />
                </div>
                <div>
                  <label>API Base Path</label>
                  <input value={cfg.apiBasePath} onChange={(e) => setCfg({ ...cfg, apiBasePath: e.target.value })} placeholder="/api/v1" />
                </div>
                <div>
                  <label>Backend URL</label>
                  <input value={cfg.backendUrl} onChange={(e) => setCfg({ ...cfg, backendUrl: e.target.value })} placeholder="http://localhost:8080" />
                </div>
                <div>
                  <label>App Server URL</label>
                  <input value={cfg.appServerUrl} onChange={(e) => setCfg({ ...cfg, appServerUrl: e.target.value })} placeholder="http://localhost:3003" />
                </div>
                <div>
                  <label>App API Base Path</label>
                  <input value={cfg.appApiBasePath} onChange={(e) => setCfg({ ...cfg, appApiBasePath: e.target.value })} placeholder="/api/v1" />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="primary" onClick={applyConfig}>Apply Config</button>
                <button onClick={health}>Health</button>
                <button onClick={serverKeys}>Server Keys</button>
              </div>
            </section>
          )}

          {section === 'app' && (
            <section className="card">
              <h3>App</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>App Public Key (hex)</label>
                  <input value={appKey} onChange={(e) => setAppKey(e.target.value)} />
                </div>
                <div>
                  <label>App Token</label>
                  <input value={appToken} onChange={(e) => setAppToken(e.target.value)} />
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Encryption Public Key (X25519, hex)</label>
                  <input value={encPublicKeyHex} onChange={(e) => setEncPublicKeyHex(e.target.value)} placeholder="hex" />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={genAppKeys}>Generate App Keys</button>
                <button onClick={registerApp}>Register App</button>
                <button onClick={createSession}>Create Session</button>
                <button onClick={fetchSchema}>Fetch Schema</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <label>Session Key</label>
                <input value={appSession} onChange={(e) => setAppSession(e.target.value)} />
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #2a366f', margin: '16px 0' }} />
              <h3>Action Configuration</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Action Name</label>
                  <input value={actionName} onChange={(e) => setActionName(e.target.value)} placeholder="registerForReceiveUpdates" />
                </div>
                <div>
                  <label>Validation Format</label>
                  <select value={validationFormat} onChange={(e) => setValidationFormat(e.target.value as any)}>
                    <option value="">None</option>
                    <option value="email">email</option>
                  </select>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Write Type</label>
                  <select value={writeKind} onChange={(e) => setWriteKind(e.target.value as any)}>
                    <option value="plain">plain</option>
                    <option value="encrypted">encrypted</option>
                  </select>
                </div>
                {writeKind === 'plain' ? (
                  <div>
                    <label>Plain Path</label>
                    <input value={writePlainPath} onChange={(e) => setWritePlainPath(e.target.value)} />
                  </div>
                ) : (
                  <div>
                    <label>Encrypted Path</label>
                    <input value={writeEncPath} onChange={(e) => setWriteEncPath(e.target.value)} />
                  </div>
                )}
              </div>
              
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={updateSchema}>Update Schema</button>
              </div>
            </section>
          )}

          {section === 'auth' && (
            <section className="card">
              <h3>Auth</h3>
              <AuthForm onSignup={signup} onLogin={login} />
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={myKeys}>My Keys</button>
              </div>
            </section>
          )}

          {section === 'write' && (
            <section className="card">
              <h3>Write</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Unencrypted URI</label>
                  <input value={plainUri} onChange={(e) => setPlainUri(e.target.value)} />
                </div>
                <div>
                  <label>Encrypted URI</label>
                  <input value={encUri} onChange={(e) => setEncUri(e.target.value)} />
                </div>
                <div>
                  <label>Plain Payload (JSON)</label>
                  <textarea value={plainPayload} onChange={(e) => setPlainPayload(e.target.value)} />
                </div>
                <div>
                  <label>Encrypted Payload (JSON)</label>
                  <textarea value={encPayload} onChange={(e) => setEncPayload(e.target.value)} />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={writePlain}>Write Plain</button>
                <button onClick={writeEnc}>Write Encrypted</button>
                <button onClick={readLast}>Read Last</button>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #2a366f', margin: '16px 0' }} />
              <h3>App Action Write</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Action</label>
                  <input value={actionName} onChange={(e) => setActionName(e.target.value)} />
                </div>
                <div>
                  <label>Test Payload (string)</label>
                  <input value={actionPayload} onChange={(e) => setActionPayload(e.target.value)} />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={testAction}>Invoke Action</button>
              </div>
            </section>
          )}
        </main>
        <aside>
          <div className="card">
            <h3>Output</h3>
            <pre className="output">{JSON.stringify(output, null, 2)}</pre>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>State</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>
              <div><strong>App Key:</strong> {appKey ? appKey.substring(0, 16) + '…' : '-'}</div>
              <div><strong>App Token:</strong> {appToken ? appToken.substring(0, 20) + '…' : '-'}</div>
              <div><strong>App Session:</strong> {appSession || '-'}</div>
              <div><strong>User:</strong> {session?.username || '-'}</div>
              <div><strong>Authenticated:</strong> {session ? 'yes' : 'no'}</div>
              <div><strong>Login Session (JWT):</strong> {session?.token ? session.token.substring(0, 20) + '…' : '-'}</div>
              <div><strong>Expires In:</strong> {session?.expiresIn ?? '-'}</div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Log</h3>
            <div className="log">
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function AuthForm({ onSignup, onLogin }: { onSignup: (u: string, p: string) => void; onLogin: (u: string, p: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
        <input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => onSignup(username, password)}>Signup</button>
        <button onClick={() => onLogin(username, password)}>Login</button>
      </div>
    </div>
  )
}
