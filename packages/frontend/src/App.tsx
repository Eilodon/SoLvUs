import { useEffect, useState } from 'react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'

const PROVER_SERVER_URL = import.meta.env.VITE_PROVER_SERVER_URL || 'http://localhost:3001'
const DEFAULT_DEVNET_CLUSTER = 'https://api.devnet.solana.com'

const SAMPLE_PROVER_INPUTS = {
  nullifier_secret: '0x0b785be5a226b8d22eb1633da6f8e988cd5e6618cd00e8d9faffa55cba1f1282',
  pubkey_x: '0x4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
  pubkey_y: '0x385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1',
  user_sig: '0x5606720c1d220338f3b7bc99cea7dd0e5a36ae56935f818d35a031ee112a34c05bec6e216b8a7934ae5c63609e612e99d657f3622203d05e746119d7cd174182',
  btc_data: 150000000,
  relayer_sig: '0xd8e07128dfdc95a9a3f59bc7001f2f3a48157a3e0f6e8eef28ffb535ef73e00e16387aa4124a7a6d1c868726286f7ff74d35d69058270d54650b23c04c4cd753',
  solana_address: '0x0d4f58e7d1b9f7e28a65194055b6ef8320a6fce8f6af02119df2584c1b0ff812',
  nonce: '0x17261c1ec623c5854eee1bb12fe05d00231b3842a4da0f8f369eb0cb9318ddff',
  relayer_pubkey_x: '0x466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
  relayer_pubkey_y: '0x6728176c3c6431f8eeda4538dc37c865e2784f3a9e77d044f33e407797e1278a',
  badge_type: 1,
  threshold: 100000000,
  is_upper_bound: false,
  timestamp: 1762000000,
  nullifier_hash: '0x1d2d0ca2a3df433de3c2c294ec46b4cef6e9c6d37af62799469e9739675f8d3d',
}

interface HealthResponse {
  prover_backend?: string
  prover_adapter_mode?: string
  solvus_program_id?: string
  devnet_mint?: {
    clusterUrl?: string
    feePayer?: string
    walletPath?: string
    solvusProgramId?: string
    groth16VerifierProgramId?: string
    zkusdMintAddress?: string
    zkusdMintDecimals?: number
  }
  [key: string]: unknown
}

interface PhantomProvider {
  isPhantom?: boolean
  publicKey?: PublicKey
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>
  signTransaction: (transaction: Transaction) => Promise<Transaction>
}

declare global {
  interface Window {
    solana?: PhantomProvider
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [payload, setPayload] = useState(JSON.stringify({ prover_inputs: SAMPLE_PROVER_INPUTS }, null, 2))
  const [zkusdAmount, setZkusdAmount] = useState('1000000')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [walletAddress, setWalletAddress] = useState('')

  const refreshHealth = async () => {
    const res = await fetch(`${PROVER_SERVER_URL}/health`)
    if (!res.ok) {
      throw new Error('Health check failed')
    }
    const body = (await res.json()) as HealthResponse
    setHealth(body)
  }

  useEffect(() => {
    refreshHealth().catch((err) => setError(err.message))
  }, [])

  const connectPhantom = async (): Promise<PhantomProvider> => {
    const provider = window.solana
    if (!provider?.isPhantom) {
      throw new Error('Phantom wallet not found in this browser')
    }

    const connected = await provider.connect()
    const address = connected.publicKey.toBase58()
    setWalletAddress(address)
    return provider
  }

  const submitProof = async () => {
    setStatus('loading')
    setError('')
    setResponse('')

    try {
      const parsed = JSON.parse(payload)
      const idempotencyKey = await sha256Hex(JSON.stringify(parsed.prover_inputs))
      const res = await fetch(`${PROVER_SERVER_URL}/prove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(parsed),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.message || body.error || 'Proof request failed')
      }

      setResponse(JSON.stringify(body, null, 2))
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      setStatus('error')
    }
  }

  const mintOnDevnet = async () => {
    setStatus('loading')
    setError('')
    setResponse('')

    try {
      const parsed = JSON.parse(payload)
      const res = await fetch(`${PROVER_SERVER_URL}/mint-devnet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prover_inputs: parsed.prover_inputs,
          zkusd_amount: Number(zkusdAmount),
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.message || body.error || 'Devnet mint failed')
      }

      setResponse(JSON.stringify(body, null, 2))
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(message)
      setStatus('error')
    }
  }

  const mintWithPhantom = async () => {
    setStatus('loading')
    setError('')
    setResponse('')

    try {
      const provider = await connectPhantom()
      const ownerPubkey = provider.publicKey?.toBase58()
      if (!ownerPubkey) {
        throw new Error('Phantom wallet is connected without a public key')
      }

      const prepareRes = await fetch(`${PROVER_SERVER_URL}/prepare-devnet-mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner_pubkey: ownerPubkey,
          zkusd_amount: Number(zkusdAmount),
        }),
      })

      const prepared = await prepareRes.json()
      if (!prepareRes.ok) {
        throw new Error(prepared.message || prepared.error || 'Prepare devnet mint failed')
      }

      if (prepared.prover_inputs) {
        setPayload(JSON.stringify({ prover_inputs: prepared.prover_inputs }, null, 2))
      }

      if (prepared.cached || !prepared.serialized_transaction) {
        setResponse(JSON.stringify(prepared, null, 2))
        setStatus('done')
        return
      }

      const clusterUrl =
        typeof prepared.cluster_url === 'string'
          ? prepared.cluster_url
          : health?.devnet_mint?.clusterUrl || DEFAULT_DEVNET_CLUSTER
      const connection = new Connection(clusterUrl, 'confirmed')
      const transaction = Transaction.from(decodeBase64(prepared.serialized_transaction))
      const signedTransaction = await provider.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signedTransaction.serialize())
      await connection.confirmTransaction(signature, 'confirmed')

      setResponse(
        JSON.stringify(
          {
            ...prepared,
            submitted_signature: signature,
          },
          null,
          2,
        ),
      )
      setStatus('done')
      await refreshHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Phantom mint error'
      setError(message)
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:px-8">
        <header className="rounded-[2rem] border border-amber-200/10 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_45%),linear-gradient(135deg,_rgba(12,10,9,0.98),_rgba(28,25,23,0.94))] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/80">Solvus Protocol</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-stone-50 md:text-5xl">Solana Runtime Scaffold</h1>
              <p className="mt-4 text-sm leading-7 text-stone-300">
                UI này bám flow Phase 1 trong docs: Relayer -&gt; Noir -&gt; Prover Server -&gt; Solana Anchor.
              </p>
            </div>
            <div className="grid gap-3 rounded-3xl border border-amber-300/10 bg-stone-900/70 p-5 text-sm text-stone-300">
              <div className="flex items-center justify-between gap-8">
                <span>Prover Server</span>
                <span className="font-mono text-amber-200">{PROVER_SERVER_URL}</span>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span>Backend</span>
                <span className="font-mono text-emerald-300">{String(health?.prover_backend || 'unknown')}</span>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span>Adapter</span>
                <span className="font-mono text-amber-200">{String(health?.prover_adapter_mode || 'unknown')}</span>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span>Status</span>
                <span className="font-mono text-sky-300">{health ? 'online' : 'pending'}</span>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span>Solvus Program</span>
                <span className="font-mono text-cyan-200">{String(health?.solvus_program_id || 'unknown')}</span>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span>Wallet</span>
                <span className="font-mono text-fuchsia-200">{walletAddress || 'phantom disconnected'}</span>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ['Identity', 'Compact secp256k1 user signature -> SHA-512 nullifier secret'],
            ['Relayer', 'BTC state lookup + signed commitment bound to user pubkey'],
            ['Prover', 'Noir inputs, deterministic nonce, cached /prove request'],
            ['Solana', 'Anchor mint/burn/PendingBtcRelease state machine'],
          ].map(([title, desc]) => (
            <article key={title} className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{title}</p>
              <p className="mt-3 text-sm leading-6 text-stone-300">{desc}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/80">POST /prove</p>
                <h2 className="mt-2 text-2xl font-bold text-stone-50">Prover Inputs Composer</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setStatus('loading')
                    setError('')
                    connectPhantom()
                      .then(() => setStatus('done'))
                      .catch((err) => {
                        setError(err instanceof Error ? err.message : 'Unknown Phantom connect error')
                        setStatus('error')
                      })
                  }}
                  disabled={status === 'loading'}
                  className="rounded-full border border-fuchsia-300/40 bg-fuchsia-300/10 px-5 py-2 text-sm font-bold text-fuchsia-100 transition hover:bg-fuchsia-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Connect Phantom
                </button>
                <button
                  onClick={submitProof}
                  disabled={status === 'loading'}
                  className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {status === 'loading' ? 'Working...' : 'Generate Proof'}
                </button>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-stone-400">
              `Mint On Devnet` dùng ví CLI cục bộ. `Mint With Phantom` sẽ xin server chuẩn bị prover inputs mới, partial-sign fee payer, rồi để Phantom ký owner và broadcast.
            </p>

            <div className="mt-5 grid gap-3 rounded-[1.5rem] border border-stone-800 bg-stone-950/60 p-4 lg:grid-cols-[auto_auto_1fr] lg:items-center">
              <label className="flex items-center gap-3 text-sm text-stone-300">
                <span>zkUSD Amount</span>
                <input
                  value={zkusdAmount}
                  onChange={(event) => setZkusdAmount(event.target.value)}
                  className="w-36 rounded-full border border-stone-700 bg-stone-900 px-4 py-2 font-mono text-xs text-stone-100 outline-none"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={mintOnDevnet}
                  disabled={status === 'loading'}
                  className="rounded-full bg-emerald-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  CLI Mint On Devnet
                </button>
                <button
                  onClick={mintWithPhantom}
                  disabled={status === 'loading'}
                  className="rounded-full bg-fuchsia-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Mint With Phantom
                </button>
              </div>
              <p className="text-xs leading-6 text-stone-500">
                Server vẫn là fee payer. Phantom chỉ cần ký owner nên user không phải nạp devnet SOL để test UI flow.
              </p>
            </div>

            <textarea
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              className="mt-5 min-h-[28rem] w-full rounded-[1.5rem] border border-stone-800 bg-stone-950/80 p-4 font-mono text-xs leading-6 text-stone-200 outline-none ring-0"
              spellCheck={false}
            />
          </article>

          <aside className="grid gap-6">
            <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Health</p>
              <pre className="mt-4 overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                {JSON.stringify(health, null, 2)}
              </pre>
            </article>

            <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Response</p>
              <pre className="mt-4 min-h-[12rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                {response || 'No proof or mint response yet.'}
              </pre>
            </article>

            <article className="rounded-[2rem] border border-red-500/20 bg-red-950/20 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-300/80">Error</p>
              <p className="mt-4 text-sm leading-6 text-red-200">{error || 'No errors.'}</p>
            </article>
          </aside>
        </section>
      </div>
    </div>
  )
}

export default App
