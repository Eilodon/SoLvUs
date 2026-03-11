import { useState } from 'react'
import { connect } from '@argent/get-starknet'
import VesuMock from './VesuMock'

// --- Constants & Types ---
const PROVER_SERVER_URL = import.meta.env.VITE_PROVER_SERVER_URL
// @ts-ignore
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS
// @ts-ignore
const STARKNET_RPC = import.meta.env.VITE_STARKNET_RPC
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

type BadgeType = 1 | 2 | 3
type Status = 'idle' | 'connecting' | 'proving' | 'submitting' | 'done' | 'error'

interface BadgeInfo {
  type: BadgeType
  tier: number
}

// --- Icons ---
const BtcIcon = () => (
  <svg className="w-6 h-6 text-orange-500" fill="currentColor" viewBox="0 0 24 24">
    <path d="M14.791 15.319c-.733 2.941-4.493 2.748-4.493 2.748v.03H8.381v-1.89h1.164c1.189 0 1.25-.658 1.25-.658v-4.045s.013-.733-.792-.733H8.381v-1.89h1.917v-.03c0 0 3.195.275 3.654-.853.458-1.127-1.996-1.545-1.996-1.545V4.62h1.917v1.89H15.11V4.62h1.917v1.89h1.164s.733.013.733.792c0 .779-.733.792-.733.792h-1.164v2.748c0 2.941-2.246 4.478-2.246 4.478zm-1.873-1.89h1.164s.733 0 .733-.792c0-.779-.733-.792-.733-.792h-1.164v1.584zm0-3.168h1.164s.733 0 .733-.792c0-.779-.733-.792-.733-.792h-1.164v1.584z"/>
  </svg>
)

const StarknetIcon = () => (
  <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
)

// --- App Component ---
function App() {
  // State
  const [btcAddress, setBtcAddress] = useState<string | null>(null)
  const [starknetAddress, setStarknetAddress] = useState<string | null>(null)
  const [selectedBadge, setSelectedBadge] = useState<BadgeInfo | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progressMessage, setProgressMessage] = useState('')
  const [result, setResult] = useState<{ txHash: string; nullifierHash: string } | null>(null)
  const [userBadges, setUserBadges] = useState<BadgeInfo[]>([])
  const [errorHandle, setErrorHandle] = useState<string | null>(null)

  // Wallet Handlers
  const connectXverse = async () => {
    // Mocking Xverse connection for Demo
    setBtcAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
  }

  const connectStarknet = async () => {
    try {
      const starknet = await connect()
      if (starknet?.isConnected) {
        setStarknetAddress(starknet.selectedAddress)
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Prove & Mint Logic
  const handleMint = async () => {
    if (!selectedBadge || !starknetAddress) return

    setStatus('proving')
    setProgressMessage('Signing identity...')
    setErrorHandle(null)

    try {
      // Step 1: Simulated Delay for Signing/Fetching
      await new Promise(r => setTimeout(r, 1000))
      setProgressMessage('Fetching BTC data from Relayer...')
      await new Promise(r => setTimeout(r, 1500))
      
      // Step 2: Call Prover Server (or use Cache in Demo Mode)
      let data;
      if (DEMO_MODE) {
        setProgressMessage('Generating ZK proof (Fast Demo Mode)...')
        await new Promise(r => setTimeout(r, 1000))
        const cacheRes = await fetch('/demo/cached_proof.json')
        if (!cacheRes.ok) throw new Error('Cached proof not found')
        data = await cacheRes.json()
      } else {
        setProgressMessage('Generating ZK proof (this takes ~30s)...')
        const response = await fetch(`${PROVER_SERVER_URL}/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            starknet_address: starknetAddress,
            badge_type: selectedBadge.type,
            tier: selectedBadge.tier,
            mock: true 
          })
        })

        if (!response.ok) throw new Error('Prover failed')
        data = await response.json()
      }
      
      // Step 3: Submit to Starknet (Simulated or Real if possible)
      setStatus('submitting')
      setProgressMessage('Submitting to Starknet...')
      await new Promise(r => setTimeout(r, 2000))

      setResult({
        txHash: '0x3f5...8e12', // Mock Tx
        nullifierHash: data.nullifier_hash || '0xabc...123'
      })
      
      setUserBadges([...userBadges, selectedBadge])
      setStatus('done')
      setProgressMessage('Badge minted successfully!')
    } catch (e: any) {
      setStatus('error')
      setErrorHandle(e.message)
      setProgressMessage('Error occurred during process')
    }
  }

  const checkBadges = async () => {
    // In real app, call is_badge_valid on contract
    setProgressMessage('Checking badges on Starkscan...')
    await new Promise(r => setTimeout(r, 1000))
    // For demo, we use the local state userBadges
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center bg-black text-slate-100 p-4 md:p-8">
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-12">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
            <span className="font-bold text-xl">S</span>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">SOLVUS</h1>
            <p className="text-[10px] text-slate-400 font-mono">PROTOCOL V1 | SEPOLIA</p>
          </div>
        </div>
        <div className="flex gap-3">
          <BtcIcon />
          <StarknetIcon />
        </div>
      </header>

      <main className="w-full max-w-4xl space-y-8">
        
        {/* Section 1: Connect Wallets */}
        <section className="glass rounded-2xl p-6 border-white/5">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Section 1 — Connect Wallets</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button 
              onClick={connectXverse}
              className={`flex items-center justify-center gap-3 py-3 px-6 rounded-xl font-bold transition-all ${
                btcAddress ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
            >
              <BtcIcon />
              {btcAddress ? `${btcAddress.slice(0, 6)}...${btcAddress.slice(-4)}` : 'Connect Xverse (BTC)'}
            </button>
            <button 
              onClick={connectStarknet}
              className={`flex items-center justify-center gap-3 py-3 px-6 rounded-xl font-bold transition-all ${
                starknetAddress ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              <StarknetIcon />
              {starknetAddress ? `${starknetAddress.slice(0, 6)}...${starknetAddress.slice(-4)}` : 'Connect Starknet'}
            </button>
          </div>
        </section>

        {/* Section 2: Select Badge */}
        <section className="glass rounded-2xl p-6 border-white/5">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Section 2 — Select Badge</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Whale Badge */}
            <div 
              className={`badge-card ${selectedBadge?.type === 1 ? 'selected' : ''}`}
              onClick={() => setSelectedBadge({ type: 1, tier: 1 })}
            >
              <div className="text-3xl mb-2">🐋</div>
              <h3 className="font-bold text-lg">Whale Badge</h3>
              <p className="text-xs text-slate-400 mb-4">Hold large BTC balance</p>
              <div className="space-y-2">
                {[1, 2, 3, 4].map(t => (
                  <button 
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setSelectedBadge({ type: 1, tier: t }) }}
                    className={`w-full py-1 text-[10px] rounded border ${
                      selectedBadge?.type === 1 && selectedBadge.tier === t ? 'bg-blue-500 border-blue-400' : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    Tier {t}: {t === 1 ? '0.1' : t === 2 ? '0.5' : t === 3 ? '1.0' : '5.0'} BTC
                  </button>
                ))}
              </div>
            </div>

            {/* Hodler Badge */}
            <div 
              className={`badge-card ${selectedBadge?.type === 2 ? 'selected' : ''}`}
              onClick={() => setSelectedBadge({ type: 2, tier: 1 })}
            >
              <div className="text-3xl mb-2">⏳</div>
              <h3 className="font-bold text-lg">Hodler Badge</h3>
              <p className="text-xs text-slate-400 mb-4">Oldest UTXO age</p>
              <div className="space-y-2">
                {[1, 2].map(t => (
                  <button 
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setSelectedBadge({ type: 2, tier: t }) }}
                    className={`w-full py-1 text-[10px] rounded border ${
                      selectedBadge?.type === 2 && selectedBadge.tier === t ? 'bg-blue-500 border-blue-400' : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    Tier {t}: {t === 1 ? '180' : '365'} Days
                  </button>
                ))}
              </div>
            </div>

            {/* Stacker Badge */}
            <div 
              className={`badge-card ${selectedBadge?.type === 3 ? 'selected' : ''}`}
              onClick={() => setSelectedBadge({ type: 3, tier: 1 })}
            >
              <div className="text-3xl mb-2">🧱</div>
              <h3 className="font-bold text-lg">Stacker Badge</h3>
              <p className="text-xs text-slate-400 mb-4">Total number of UTXOs</p>
              <div className="space-y-2">
                {[1, 2, 3].map(t => (
                  <button 
                    key={t}
                    onClick={(e) => { e.stopPropagation(); setSelectedBadge({ type: 3, tier: t }) }}
                    className={`w-full py-1 text-[10px] rounded border ${
                      selectedBadge?.type === 3 && selectedBadge.tier === t ? 'bg-blue-500 border-blue-400' : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    Tier {t}: {t === 1 ? '5' : t === 2 ? '15' : '30'} UTXOs
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Prove & Mint */}
        <section className="glass rounded-2xl p-6 border-white/5 text-center">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6 text-left">Section 3 — Prove & Mint</h2>
          
          <button
            disabled={!btcAddress || !starknetAddress || !selectedBadge || status === 'proving' || status === 'submitting'}
            onClick={handleMint}
            className="w-full max-w-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-4 rounded-xl font-bold text-lg shadow-xl shadow-blue-900/20 transition-all disabled:opacity-50 disabled:grayscale"
          >
            {status === 'idle' && 'Generate ZK Proof & Mint Badge'}
            {(status === 'proving' || status === 'submitting') && 'Processing...'}
            {status === 'done' && 'Mint Another Badge'}
            {status === 'error' && 'Retry Minting'}
          </button>

          {status !== 'idle' && (
            <div className="mt-6 flex flex-col items-center">
              <div className="flex items-center gap-3 mb-2">
                {(status === 'proving' || status === 'submitting') && (
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                )}
                <span className={`text-sm font-medium ${status === 'error' ? 'text-red-400' : 'text-blue-400'}`}>
                  {progressMessage}
                </span>
              </div>
              
              {status === 'done' && result && (
                <div className="mt-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 w-full text-left">
                  <p className="text-xs text-emerald-400 font-mono mb-1">TX HASH: {result.txHash}</p>
                  <p className="text-xs text-emerald-400 font-mono">NULLIFIER: {result.nullifierHash}</p>
                  <a 
                    href={`https://sepolia.starkscan.co/tx/${result.txHash}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="mt-3 inline-block text-xs font-bold text-white underline"
                  >
                    View on Starkscan
                  </a>
                </div>
              )}

              {status === 'error' && errorHandle && (
                <p className="mt-2 text-xs text-red-500 font-mono italic">{errorHandle}</p>
              )}
            </div>
          )}
        </section>

        {/* Section 4: Verify Badge */}
        <section className="glass rounded-2xl p-6 border-white/5">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">Section 4 — Verify Badge</h2>
          <div className="space-y-4">
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Enter Starknet Address" 
                value={starknetAddress || ''}
                readOnly
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-blue-500/50"
              />
              <button 
                onClick={checkBadges}
                className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-sm font-bold border border-white/10"
              >
                Check Badges
              </button>
            </div>

            {userBadges.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {userBadges.map((b, i) => (
                  <span key={i} className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold border border-blue-500/30">
                    {b.type === 1 ? 'Whale' : b.type === 2 ? 'Hodler' : 'Stacker'} (Tier {b.tier})
                  </span>
                ))}
              </div>
            )}

            <VesuMock starknetAddress={starknetAddress} badges={userBadges} />
          </div>
        </section>

      </main>

      <footer className="mt-12 text-slate-600 text-[10px] uppercase tracking-widest">
        POWERED BY NOIR ZKP & STARKNET
      </footer>
    </div>
  )
}

export default App
