import { useEffect, useState } from 'react'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'

const PROVER_SERVER_URL =
  import.meta.env.VITE_PROVER_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
const DEFAULT_DEVNET_CLUSTER = 'https://api.devnet.solana.com'

const SAMPLE_PROVER_INPUTS = {
  nullifier_secret: '0x0b785be5a226b8d22eb1633da6f8e988cd5e6618cd00e8d9faffa55cba1f1282',
  pubkey_x: '0x4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa',
  pubkey_y: '0x385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1',
  user_sig: '0x5606720c1d220338f3b7bc99cea7dd0e5a36ae56935f818d35a031ee112a34c05bec6e216b8a7934ae5c63609e612e99d657f3622203d05e746119d7cd174182',
  btc_data: 150000000,
  relayer_sig: '0xd8e07128dfdc95a9a3f59bc7001f2f3a48157a3e0f6e8eef28ffb535ef73e00e16387aa4124a7a6d1c868726286f7ff74d35d69058270d54650b23c04c4cd753',
  solana_address: '0x0d4f58e7d1b9f7e28a65194055b6ef8320a6fce8f6af02119df2584c1b0ff812',
  dlc_contract_id: '0x0000000000000000000000000000000000000000000000000000000000000001',
  relayer_pubkey_x: '0x466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27',
  relayer_pubkey_y: '0x6728176c3c6431f8eeda4538dc37c865e2784f3a9e77d044f33e407797e1278a',
  collateral_profile: 1,
  threshold: 100000000,
  is_upper_bound: false,
  nullifier_hash: '0x1d2d0ca2a3df433de3c2c294ec46b4cef6e9c6d37af62799469e9739675f8d3d',
}

interface HealthResponse {
  prover_backend?: string
  prover_adapter_mode?: string
  artifact_demo_mode?: boolean
  demo_artifact_path?: string | null
  demo_context?: {
    nullifier_hash?: string
    owner_pubkey?: string
    permission_profile?: {
      institution_id_hash?: string
    }
  } | null
  solvus_program_id?: string
  devnet_mint?: {
    clusterUrl?: string
    feePayer?: string
    wallet_configured?: boolean
    solvusProgramId?: string
    groth16VerifierProgramId?: string
    zkusdMintAddress?: string
    zkusdMintDecimals?: number
  }
  compliance_api_key_configured?: boolean
  [key: string]: unknown
}

interface ComplianceContext {
  institutionIdHash: string
  nullifierHash: string
}

type DeskView = 'compliance' | 'operator' | 'advanced'
type ActionKind = 'idle' | 'success' | 'error' | 'loading'

interface InstitutionSnapshot {
  institution_pda: string
  institution_id_hash: string
  approved_operator: string
  status: 'active' | 'suspended' | 'terminated' | 'uninitialized'
  risk_tier: number
  daily_mint_cap: number
  lifetime_mint_cap: number
  minted_total: number
  current_period_minted: number
  travel_rule_required: boolean
  updated_at: number
}

interface PermitSnapshot {
  compliance_permit_pda: string
  operator: string
  nullifier_hash: string
  max_amount: number
  expires_at: number
  kyt_score: number
  travel_rule_ref_hash: string
  state: 'pending' | 'used' | 'revoked'
  issued_at: number
  used_at: number
}

interface HolderSnapshot {
  token_account: string
  owner: string
  mint: string
  amount: string
  frozen: boolean
}

interface ComplianceSnapshot {
  institution: InstitutionSnapshot | null
  permit: PermitSnapshot | null
  holder: HolderSnapshot | null
}

interface AuditTrailRecord {
  record_id: string
  recorded_at: string
  recorded_unix: number
  event_type: string
  institution_id_hash?: string
  nullifier_hash?: string
  operator?: string
  amount?: number
  kyt_score?: number
  travel_rule_ref_hash?: string
  tx_signature?: string
  status?: string
  owner_pubkey?: string
}

interface AuditTrailResponse {
  institution_id_hash: string
  record_count: number
  records: AuditTrailRecord[]
}

interface PreparedMintResponse {
  nullifier_hash?: string
  permission_profile?: {
    institution_id_hash?: string
  }
  oracle_live_price_e8?: number
  oracle_min_price_e8?: number
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

function buildApiHeaders(apiKey: string, includeApiKey = false): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (includeApiKey && apiKey) {
    headers['x-api-key'] = apiKey
  }
  return headers
}

function buildRequestHeaders(apiKey: string, includeApiKey = false, includeJson = true): HeadersInit {
  const headers: Record<string, string> = {}
  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }
  if (includeApiKey && apiKey) {
    headers['x-api-key'] = apiKey
  }
  return headers
}

function parseJsonObject<T>(value: string): T | null {
  if (!value.trim()) {
    return null
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function formatUsdAmount(amount?: number | string | null): string {
  if (amount === undefined || amount === null) {
    return 'n/a'
  }
  const numeric = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(numeric)) {
    return 'n/a'
  }
  return `$${(numeric / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatPrice1e8(amount?: number | null): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) {
    return 'n/a'
  }
  return `$${(amount / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatTimestamp(unix?: number | null): string {
  if (!unix || !Number.isFinite(unix)) {
    return 'n/a'
  }
  return new Date(unix * 1000).toLocaleString()
}

function compactHash(value?: string | null): string {
  if (!value) {
    return 'n/a'
  }
  if (value.length <= 18) {
    return value
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`
}

function badgeClasses(status?: string | null): string {
  if (status === 'active' || status === 'used' || status === 'online') {
    return 'border-emerald-400/30 bg-emerald-300/10 text-emerald-200'
  }
  if (status === 'pending') {
    return 'border-sky-400/30 bg-sky-300/10 text-sky-200'
  }
  if (status === 'suspended' || status === 'paused') {
    return 'border-amber-400/30 bg-amber-300/10 text-amber-200'
  }
  if (status === 'revoked' || status === 'terminated' || status === 'frozen') {
    return 'border-rose-400/30 bg-rose-300/10 text-rose-200'
  }
  return 'border-stone-700 bg-stone-900 text-stone-300'
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [payload, setPayload] = useState(JSON.stringify({ prover_inputs: SAMPLE_PROVER_INPUTS }, null, 2))
  const [zkusdAmount, setZkusdAmount] = useState('1000000')
  const [minBtcPriceE8, setMinBtcPriceE8] = useState('')
  const [institutionName, setInstitutionName] = useState('StableHacks Demo Treasury')
  const [kybReference, setKybReference] = useState('KYB-APPROVED-DEMO')
  const [travelRuleReference, setTravelRuleReference] = useState('TRAVEL-RULE-DEMO')
  const [kytScore, setKytScore] = useState('24')
  const [permitTtlSeconds, setPermitTtlSeconds] = useState('900')
  const [dailyMintCap, setDailyMintCap] = useState('10000000')
  const [lifetimeMintCap, setLifetimeMintCap] = useState('100000000')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle')
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [lastActionMessage, setLastActionMessage] = useState('')
  const [lastActionKind, setLastActionKind] = useState<ActionKind>('idle')
  const [complianceApiKey, setComplianceApiKey] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [activeView, setActiveView] = useState<DeskView>('compliance')
  const [complianceContext, setComplianceContext] = useState<ComplianceContext | null>(null)
  const [complianceState, setComplianceState] = useState('')
  const [auditTrail, setAuditTrail] = useState<AuditTrailRecord[]>([])
  const [oracleSnapshot, setOracleSnapshot] = useState<{ live?: number; floor?: number }>({})
  const complianceSnapshot = parseJsonObject<ComplianceSnapshot>(complianceState)
  const responseSnapshot = parseJsonObject<Record<string, unknown>>(response)
  const institution = complianceSnapshot?.institution ?? null
  const permit = complianceSnapshot?.permit ?? null
  const holder = complianceSnapshot?.holder ?? null
  const artifactDemoMode = health?.artifact_demo_mode === true

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

  useEffect(() => {
    if (status === 'loading') {
      setLastActionKind('loading')
      setLastActionMessage('Request in progress...')
      return
    }
    if (status === 'error' && error) {
      setLastActionKind('error')
      setLastActionMessage(error)
      return
    }
    if (status === 'done' && response) {
      setLastActionKind('success')
      setLastActionMessage('Action completed successfully.')
    }
  }, [status, error, response])

  useEffect(() => {
    const institutionIdHash = health?.demo_context?.permission_profile?.institution_id_hash
    const nullifierHash = health?.demo_context?.nullifier_hash
    if (!artifactDemoMode || typeof institutionIdHash !== 'string' || typeof nullifierHash !== 'string') {
      return
    }

    const nextContext = { institutionIdHash, nullifierHash }
    if (
      complianceContext?.institutionIdHash === nextContext.institutionIdHash &&
      complianceContext?.nullifierHash === nextContext.nullifierHash
    ) {
      return
    }

    setComplianceContext(nextContext)
    syncComplianceState(nextContext)
      .then(async () => {
        if (complianceApiKey) {
          await syncAuditTrail(nextContext)
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to bootstrap demo context'))
  }, [artifactDemoMode, health, complianceApiKey])

  const buildPermissionedRequestPayload = () => ({
    institution_name: institutionName,
    kyb_reference: kybReference,
    travel_rule_reference: travelRuleReference,
    kyt_score: Number(kytScore),
    permit_ttl_seconds: Number(permitTtlSeconds),
    daily_mint_cap: Number(dailyMintCap),
    lifetime_mint_cap: Number(lifetimeMintCap),
    travel_rule_required: true,
    ...(minBtcPriceE8.trim().length > 0 ? { min_btc_price_e8: Number(minBtcPriceE8) } : {}),
  })

  const resolveComplianceOwner = (): string => {
    if (!complianceSnapshot) {
      throw new Error('No compliance state loaded yet')
    }
    const owner = complianceSnapshot.holder?.owner || complianceSnapshot.institution?.approved_operator
    if (typeof owner !== 'string' || owner.length === 0) {
      throw new Error('No holder owner found in compliance snapshot')
    }
    return owner
  }

  const syncAuditTrail = async (context: ComplianceContext) => {
    const params = new URLSearchParams({
      institution_id_hash: context.institutionIdHash,
    })
    const res = await fetch(`${PROVER_SERVER_URL}/compliance/audit-trail?${params.toString()}`, {
      headers: buildRequestHeaders(complianceApiKey, true, false),
    })
    const body = (await res.json()) as AuditTrailResponse & { message?: string; error?: string }
    if (!res.ok) {
      throw new Error(body.message || body.error || 'Audit trail request failed')
    }
    setAuditTrail(body.records || [])
  }

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

  const syncComplianceState = async (context: ComplianceContext) => {
    const params = new URLSearchParams({
      institution_id_hash: context.institutionIdHash,
      nullifier_hash: context.nullifierHash,
    })
    const res = await fetch(`${PROVER_SERVER_URL}/compliance/state?${params.toString()}`)
    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.message || body.error || 'Compliance state request failed')
    }
    setComplianceState(JSON.stringify(body, null, 2))
  }

  const captureComplianceContext = async (body: PreparedMintResponse, fallbackNullifierHash?: string) => {
    const institutionIdHash = body.permission_profile?.institution_id_hash
    const nullifierHash = body.nullifier_hash || fallbackNullifierHash
    if (typeof body.oracle_live_price_e8 === 'number' || typeof body.oracle_min_price_e8 === 'number') {
      setOracleSnapshot({
        live: typeof body.oracle_live_price_e8 === 'number' ? body.oracle_live_price_e8 : oracleSnapshot.live,
        floor: typeof body.oracle_min_price_e8 === 'number' ? body.oracle_min_price_e8 : oracleSnapshot.floor,
      })
    }
    if (typeof institutionIdHash === 'string' && typeof nullifierHash === 'string') {
      const context = { institutionIdHash, nullifierHash }
      setComplianceContext(context)
      await Promise.all([syncComplianceState(context), syncAuditTrail(context)])
    }
  }

  const mutateComplianceState = async (path: string, payload: Record<string, unknown>) => {
    if (!complianceContext) {
      throw new Error('No compliance context loaded yet')
    }

    const res = await fetch(`${PROVER_SERVER_URL}${path}`, {
      method: 'POST',
      headers: buildApiHeaders(complianceApiKey, true),
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.message || body.error || 'Compliance mutation failed')
    }
    await Promise.all([syncComplianceState(complianceContext), syncAuditTrail(complianceContext)])
    setResponse(JSON.stringify(body, null, 2))
  }

  const submitProof = async () => {
    setStatus('loading')
    setError('')
    setResponse('')

    try {
      const parsed = artifactDemoMode ? {} : JSON.parse(payload)
      const idempotencyKey = artifactDemoMode
        ? 'artifact-demo-proof'
        : await sha256Hex(JSON.stringify(parsed.prover_inputs))
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
      setLastActionMessage('Proof response loaded.')
      await captureComplianceContext(health?.demo_context ?? {}, body.nullifier_hash)
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
      const parsed = artifactDemoMode ? null : JSON.parse(payload)
      const res = await fetch(`${PROVER_SERVER_URL}/mint-devnet`, {
        method: 'POST',
        headers: buildApiHeaders(complianceApiKey, true),
        body: JSON.stringify({
          ...(artifactDemoMode ? {} : { prover_inputs: parsed.prover_inputs }),
          zkusd_amount: Number(zkusdAmount),
          ...buildPermissionedRequestPayload(),
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.message || body.error || 'Devnet mint failed')
      }

      await captureComplianceContext(body, parsed?.prover_inputs?.nullifier_hash)
      setResponse(JSON.stringify(body, null, 2))
      setLastActionMessage('Demo mint request completed.')
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
      if (artifactDemoMode) {
        throw new Error('Browser-wallet mint is disabled while Railway is running in artifact demo mode')
      }
      const provider = await connectPhantom()
      const ownerPubkey = provider.publicKey?.toBase58()
      if (!ownerPubkey) {
        throw new Error('Phantom wallet is connected without a public key')
      }

      const prepareRes = await fetch(`${PROVER_SERVER_URL}/prepare-devnet-mint`, {
        method: 'POST',
        headers: buildApiHeaders(complianceApiKey, true),
        body: JSON.stringify({
          owner_pubkey: ownerPubkey,
          zkusd_amount: Number(zkusdAmount),
          ...buildPermissionedRequestPayload(),
        }),
      })

      const prepared = await prepareRes.json()
      if (!prepareRes.ok) {
        throw new Error(prepared.message || prepared.error || 'Prepare devnet mint failed')
      }

      if (prepared.prover_inputs) {
        setPayload(JSON.stringify({ prover_inputs: prepared.prover_inputs }, null, 2))
      }

      await captureComplianceContext(prepared, prepared.prover_inputs?.nullifier_hash)

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
      if (prepared.permission_profile?.institution_id_hash && prepared.nullifier_hash) {
        const recordRes = await fetch(`${PROVER_SERVER_URL}/compliance/record-mint-submission`, {
          method: 'POST',
          headers: buildRequestHeaders(complianceApiKey, true),
          body: JSON.stringify({
            institution_id_hash: prepared.permission_profile.institution_id_hash,
            nullifier_hash: prepared.nullifier_hash,
            signature,
          }),
        })
        if (!recordRes.ok) {
          const body = await recordRes.json()
          throw new Error(body.message || body.error || 'Failed to record mint submission')
        }
      }

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
      const mintedContext =
        prepared.permission_profile?.institution_id_hash && prepared.nullifier_hash
          ? {
              institutionIdHash: prepared.permission_profile.institution_id_hash,
              nullifierHash: prepared.nullifier_hash,
            }
          : complianceContext
      if (mintedContext) {
        await Promise.all([syncComplianceState(mintedContext), syncAuditTrail(mintedContext)])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Phantom mint error'
      setError(message)
      setStatus('error')
    }
  }

  const suspendInstitution = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No institution loaded for suspend action')
      }
      await mutateComplianceState('/compliance/institution-status', {
        institution_id_hash: complianceContext.institutionIdHash,
        status: 'suspended',
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown suspend error'
      setError(message)
      setStatus('error')
    }
  }

  const activateInstitution = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No institution loaded for activate action')
      }
      await mutateComplianceState('/compliance/institution-status', {
        institution_id_hash: complianceContext.institutionIdHash,
        status: 'active',
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown activate error'
      setError(message)
      setStatus('error')
    }
  }

  const terminateInstitution = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No institution loaded for terminate action')
      }
      await mutateComplianceState('/compliance/institution-status', {
        institution_id_hash: complianceContext.institutionIdHash,
        status: 'terminated',
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown terminate error'
      setError(message)
      setStatus('error')
    }
  }

  const revokePermit = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No permit loaded for revoke action')
      }
      await mutateComplianceState('/compliance/revoke-permit', {
        institution_id_hash: complianceContext.institutionIdHash,
        nullifier_hash: complianceContext.nullifierHash,
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown revoke error'
      setError(message)
      setStatus('error')
    }
  }

  const freezeHolder = async () => {
    setStatus('loading')
    setError('')
    try {
      await mutateComplianceState('/compliance/freeze-holder', {
        institution_id_hash: complianceContext?.institutionIdHash,
        owner_pubkey: resolveComplianceOwner(),
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown holder freeze error'
      setError(message)
      setStatus('error')
    }
  }

  const thawHolder = async () => {
    setStatus('loading')
    setError('')
    try {
      await mutateComplianceState('/compliance/thaw-holder', {
        institution_id_hash: complianceContext?.institutionIdHash,
        owner_pubkey: resolveComplianceOwner(),
      })
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown holder thaw error'
      setError(message)
      setStatus('error')
    }
  }

  const pauseProtocol = async () => {
    setStatus('loading')
    setError('')
    try {
      await mutateComplianceState('/protocol/pause', { paused: true })
      setStatus('done')
      await refreshHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown protocol pause error'
      setError(message)
      setStatus('error')
    }
  }

  const resumeProtocol = async () => {
    setStatus('loading')
    setError('')
    try {
      await mutateComplianceState('/protocol/pause', { paused: false })
      setStatus('done')
      await refreshHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown protocol resume error'
      setError(message)
      setStatus('error')
    }
  }

  const refreshAuditDashboard = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No compliance context loaded yet')
      }
      await Promise.all([syncComplianceState(complianceContext), syncAuditTrail(complianceContext)])
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown compliance refresh error'
      setError(message)
      setStatus('error')
    }
  }

  const warmOracle = async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await fetch(`${PROVER_SERVER_URL}/compliance/warm-oracle`, {
        method: 'POST',
        headers: buildRequestHeaders(complianceApiKey, true),
        body: JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.message || body.error || 'Oracle warm-up failed')
      }
      setOracleSnapshot({
        live: typeof body.live_price_e8 === 'number' ? body.live_price_e8 : oracleSnapshot.live,
        floor: typeof body.live_price_e8 === 'number' ? body.live_price_e8 : oracleSnapshot.floor,
      })
      setResponse(JSON.stringify(body, null, 2))
      setLastActionMessage('Oracle warm-up succeeded.')
      setStatus('done')
      await refreshHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown oracle warm-up error'
      setError(message)
      setStatus('error')
    }
  }

  const warmProofCache = async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await fetch(`${PROVER_SERVER_URL}/compliance/warm-proof`, {
        method: 'POST',
        headers: buildRequestHeaders(complianceApiKey, true),
        body: JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.message || body.error || 'Proof warm-up failed')
      }
      setResponse(JSON.stringify(body, null, 2))
      setLastActionMessage('Proof warm-up succeeded.')
      await captureComplianceContext(health?.demo_context ?? {}, body.nullifier_hash)
      setStatus('done')
      await refreshHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown proof warm-up error'
      setError(message)
      setStatus('error')
    }
  }

  const exportAuditTrail = async () => {
    setStatus('loading')
    setError('')
    try {
      if (!complianceContext) {
        throw new Error('No compliance context loaded yet')
      }
      const params = new URLSearchParams({
        institution_id_hash: complianceContext.institutionIdHash,
        format: 'csv',
      })
      const res = await fetch(`${PROVER_SERVER_URL}/compliance/audit-trail?${params.toString()}`, {
        headers: buildRequestHeaders(complianceApiKey, true, false),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.message || body.error || 'Audit export failed')
      }
      const csv = await res.text()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `solvus_audit_${complianceContext.institutionIdHash.slice(2, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus('done')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown audit export error'
      setError(message)
      setStatus('error')
    }
  }

  const oracleLivePriceE8 =
    typeof responseSnapshot?.oracle_live_price_e8 === 'number'
      ? responseSnapshot.oracle_live_price_e8
      : oracleSnapshot.live
  const oracleMinPriceE8 =
    typeof responseSnapshot?.oracle_min_price_e8 === 'number'
      ? responseSnapshot.oracle_min_price_e8
      : oracleSnapshot.floor
  const latestMintSignature =
    typeof responseSnapshot?.submitted_signature === 'string'
      ? responseSnapshot.submitted_signature
      : typeof responseSnapshot?.signature === 'string'
        ? responseSnapshot.signature
        : undefined

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 md:px-8">
        <header className="rounded-[2rem] border border-amber-200/10 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_40%),linear-gradient(135deg,_rgba(12,10,9,0.98),_rgba(28,25,23,0.94))] p-8 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300/80">StableHacks 2026 / Institutional Vaults</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight text-stone-50 md:text-5xl">
                AMINA-Style BTC-Backed Issuance Control Plane
              </h1>
              <p className="mt-4 text-sm leading-7 text-stone-300">
                SoLvUs packages a real Groth16-backed mint flow into two operational surfaces: a compliance desk for institution controls and an operator desk for permit-bound issuance. The raw debug desk remains available under Advanced.
              </p>
            </div>
            <div className="grid gap-3 rounded-3xl border border-amber-300/10 bg-stone-900/70 p-5 text-sm text-stone-300 xl:min-w-[22rem]">
              {[
                ['Prover Server', PROVER_SERVER_URL],
                ['Backend', String(health?.prover_backend || 'unknown')],
                ['Adapter', String(health?.prover_adapter_mode || 'unknown')],
                ['Status', health ? 'online' : 'pending'],
                ['Compliance Auth', health?.compliance_api_key_configured ? 'api-key required' : 'missing'],
                ['Program', String(health?.solvus_program_id || 'unknown')],
                ['Wallet', walletAddress || 'browser wallet disconnected'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-8">
                  <span>{label}</span>
                  <span className="font-mono text-right text-amber-200">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap gap-3">
          {([
            ['compliance', 'Compliance'],
            ['operator', 'Operator'],
            ['advanced', 'Advanced'],
          ] as Array<[DeskView, string]>).map(([view, label]) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`rounded-full px-5 py-2 text-sm font-bold transition ${
                activeView === view
                  ? 'bg-amber-300 text-stone-950'
                  : 'border border-stone-700 bg-stone-900 text-stone-300 hover:border-amber-300/40 hover:text-stone-100'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Protected Endpoint Access</p>
              <p className="mt-2 text-sm text-stone-400">
                Compliance and devnet mint requests use a session-scoped API key entered here. The key is not embedded into the frontend build.
              </p>
            </div>
            <label className="flex min-w-[20rem] flex-col gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Session API Key
              <input
                type="password"
                value={complianceApiKey}
                onChange={(event) => setComplianceApiKey(event.target.value)}
                placeholder="Paste COMPLIANCE_API_KEY for this session"
                autoComplete="off"
                spellCheck={false}
                className="rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-sm font-normal normal-case tracking-normal text-stone-100 outline-none transition focus:border-amber-300/50"
              />
            </label>
          </div>
        </section>

        <section
          className={`rounded-[1.25rem] border px-5 py-4 text-sm ${
            lastActionKind === 'success'
              ? 'border-emerald-400/30 bg-emerald-300/10 text-emerald-100'
              : lastActionKind === 'error'
                ? 'border-red-400/30 bg-red-300/10 text-red-100'
                : lastActionKind === 'loading'
                  ? 'border-amber-400/30 bg-amber-300/10 text-amber-100'
                  : 'border-stone-800 bg-stone-900/60 text-stone-400'
          }`}
        >
          {lastActionMessage || 'Ready.'}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <article className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Institution</p>
            <p className="mt-3 text-lg font-bold text-stone-50">{institution?.status ? institution.status.toUpperCase() : 'NOT LOADED'}</p>
            <p className="mt-2 text-sm text-stone-400">{institution ? compactHash(institution.institution_id_hash) : 'Prepare or mint to provision one.'}</p>
          </article>
          <article className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Permit</p>
            <p className="mt-3 text-lg font-bold text-stone-50">{permit?.state ? permit.state.toUpperCase() : 'NOT LOADED'}</p>
            <p className="mt-2 text-sm text-stone-400">{permit ? `${formatUsdAmount(permit.max_amount)} / score ${permit.kyt_score}` : 'Travel Rule + KYT gate pending.'}</p>
          </article>
          <article className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Oracle Guard</p>
            <p className="mt-3 text-lg font-bold text-stone-50">{formatPrice1e8(oracleMinPriceE8 || oracleLivePriceE8)}</p>
            <p className="mt-2 text-sm text-stone-400">Live {formatPrice1e8(oracleLivePriceE8)} / floor {formatPrice1e8(oracleMinPriceE8)}</p>
          </article>
          <article className="rounded-[1.5rem] border border-stone-800 bg-stone-900/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Audit Trail</p>
            <p className="mt-3 text-lg font-bold text-stone-50">{auditTrail.length} records</p>
            <p className="mt-2 text-sm text-stone-400">{latestMintSignature ? `Latest tx ${compactHash(latestMintSignature)}` : 'No recorded mint tx yet.'}</p>
          </article>
        </section>

        {activeView === 'compliance' && (
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="grid gap-6">
              <article className="rounded-[2rem] border border-amber-300/20 bg-amber-950/10 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300/80">Compliance Officer</p>
                    <h2 className="mt-2 text-2xl font-bold text-stone-50">Institution Control Desk</h2>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={refreshAuditDashboard}
                      disabled={status === 'loading' || !complianceContext}
                      className="rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-bold text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Refresh
                    </button>
                    <button
                      onClick={exportAuditTrail}
                      disabled={status === 'loading' || !complianceContext}
                      className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-xs font-bold text-sky-100 transition hover:bg-sky-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={warmOracle}
                      disabled={status === 'loading'}
                      className="rounded-full border border-stone-700 bg-stone-900 px-4 py-2 text-xs font-bold text-stone-200 transition hover:border-amber-300/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Warm Oracle
                    </button>
                    <button
                      onClick={warmProofCache}
                      disabled={status === 'loading'}
                      className="rounded-full border border-stone-700 bg-stone-900 px-4 py-2 text-xs font-bold text-stone-200 transition hover:border-amber-300/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Warm Proof
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Institution</p>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeClasses(institution?.status)}`}>
                        {institution?.status || 'unloaded'}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-stone-300">
                      <div className="flex items-center justify-between gap-4">
                        <dt>Institution ID</dt>
                        <dd className="font-mono text-stone-100">{compactHash(institution?.institution_id_hash)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Approved Operator</dt>
                        <dd className="font-mono text-stone-100">{compactHash(institution?.approved_operator)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Daily Cap</dt>
                        <dd>{formatUsdAmount(institution?.daily_mint_cap)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Lifetime Cap</dt>
                        <dd>{formatUsdAmount(institution?.lifetime_mint_cap)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Minted Total</dt>
                        <dd>{formatUsdAmount(institution?.minted_total)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Current Period</dt>
                        <dd>{formatUsdAmount(institution?.current_period_minted)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Active Permit</p>
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeClasses(permit?.state)}`}>
                        {permit?.state || 'unloaded'}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-stone-300">
                      <div className="flex items-center justify-between gap-4">
                        <dt>Nullifier</dt>
                        <dd className="font-mono text-stone-100">{compactHash(permit?.nullifier_hash)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Max Amount</dt>
                        <dd>{formatUsdAmount(permit?.max_amount)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>KYT Score</dt>
                        <dd>{permit?.kyt_score ?? 'n/a'}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Travel Rule</dt>
                        <dd className="font-mono text-stone-100">{compactHash(permit?.travel_rule_ref_hash)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Expires</dt>
                        <dd>{formatTimestamp(permit?.expires_at)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt>Holder</dt>
                        <dd>{holder ? formatUsdAmount(holder.amount) : 'n/a'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={suspendInstitution} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-red-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50">Suspend Institution</button>
                  <button onClick={activateInstitution} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-emerald-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">Reactivate</button>
                  <button onClick={terminateInstitution} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-stone-200 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50">Terminate</button>
                  <button onClick={revokePermit} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-amber-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50">Revoke Permit</button>
                  <button onClick={freezeHolder} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-rose-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50">Freeze Holder</button>
                  <button onClick={thawHolder} disabled={status === 'loading' || !complianceContext} className="rounded-full bg-lime-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-50">Thaw Holder</button>
                  <button onClick={pauseProtocol} disabled={status === 'loading'} className="rounded-full bg-violet-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">Pause Protocol</button>
                  <button onClick={resumeProtocol} disabled={status === 'loading'} className="rounded-full bg-sky-300 px-4 py-2 text-xs font-bold text-stone-950 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50">Resume Protocol</button>
                </div>
              </article>

              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Compliance Audit Trail</p>
                    <h3 className="mt-2 text-xl font-bold text-stone-50">Institution Timeline</h3>
                  </div>
                  <span className="rounded-full border border-stone-700 bg-stone-950 px-3 py-1 text-xs font-bold text-stone-300">{auditTrail.length} records</span>
                </div>
                <div className="mt-5 grid gap-3">
                  {auditTrail.length > 0 ? auditTrail.map((record) => (
                    <div key={record.record_id} className="rounded-[1.25rem] border border-stone-800 bg-stone-950/80 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeClasses(record.status || record.event_type.toLowerCase())}`}>
                          {record.event_type}
                        </span>
                        <span className="text-xs text-stone-500">{new Date(record.recorded_at).toLocaleString()}</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-stone-300 md:grid-cols-2">
                        <div>Operator: <span className="font-mono text-stone-100">{compactHash(record.operator || record.owner_pubkey)}</span></div>
                        <div>Amount: <span className="text-stone-100">{formatUsdAmount(record.amount)}</span></div>
                        <div>KYT: <span className="text-stone-100">{record.kyt_score ?? 'n/a'}</span></div>
                        <div>Tx: <span className="font-mono text-stone-100">{compactHash(record.tx_signature)}</span></div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.25rem] border border-dashed border-stone-800 bg-stone-950/60 p-5 text-sm text-stone-500">
                      No audit records yet. Prepare or execute a mint to populate the compliance journal.
                    </div>
                  )}
                </div>
              </article>
            </div>

            <aside className="grid gap-6">
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Current Snapshot</p>
                <pre className="mt-4 min-h-[18rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {complianceState || 'Prepare or mint once to load institution and permit state.'}
                </pre>
              </article>
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Latest Response</p>
                <pre className="mt-4 min-h-[12rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {response || 'No proof or mint response yet.'}
                </pre>
              </article>
            </aside>
          </section>
        )}

        {activeView === 'operator' && (
          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300/80">Operator Mint Desk</p>
                  <h2 className="mt-2 text-2xl font-bold text-stone-50">Permit-Bound Issuance</h2>
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
                    Connect Browser Wallet
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

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Collateral Check</p>
                  <p className="mt-3 text-lg font-bold text-stone-50">{formatPrice1e8(oracleLivePriceE8)}</p>
                  <p className="mt-2 text-sm text-stone-400">Pyth live BTC/USD / floor {formatPrice1e8(oracleMinPriceE8)}</p>
                </div>
                <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Active Permit</p>
                  <p className="mt-3 text-lg font-bold text-stone-50">{formatUsdAmount(permit?.max_amount)}</p>
                  <p className="mt-2 text-sm text-stone-400">Expires {formatTimestamp(permit?.expires_at)}</p>
                </div>
                <div className="rounded-[1.5rem] border border-stone-800 bg-stone-950/70 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Holder Balance</p>
                  <p className="mt-3 text-lg font-bold text-stone-50">{formatUsdAmount(holder?.amount)}</p>
                  <p className="mt-2 text-sm text-stone-400">{holder?.frozen ? 'Account frozen by compliance' : 'Transfer account active'}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 rounded-[1.5rem] border border-stone-800 bg-stone-950/60 p-5 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>Institution Label</span>
                  <input value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>KYB Reference</span>
                  <input value={kybReference} onChange={(event) => setKybReference(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>Travel Rule Reference</span>
                  <input value={travelRuleReference} onChange={(event) => setTravelRuleReference(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>KYT Score</span>
                  <input value={kytScore} onChange={(event) => setKytScore(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>Permit TTL Seconds</span>
                  <input value={permitTtlSeconds} onChange={(event) => setPermitTtlSeconds(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>zkUSD Amount</span>
                  <input value={zkusdAmount} onChange={(event) => setZkusdAmount(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>Daily Mint Cap</span>
                  <input value={dailyMintCap} onChange={(event) => setDailyMintCap(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300">
                  <span>Lifetime Mint Cap</span>
                  <input value={lifetimeMintCap} onChange={(event) => setLifetimeMintCap(event.target.value)} className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
                <label className="grid gap-2 text-sm text-stone-300 md:col-span-2">
                  <span>Min BTC Price 1e8</span>
                  <input value={minBtcPriceE8} onChange={(event) => setMinBtcPriceE8(event.target.value)} placeholder="auto from oracle" className="rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none" />
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={mintOnDevnet} disabled={status === 'loading'} className="rounded-full bg-emerald-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60">{artifactDemoMode ? 'Run Demo Mint' : 'CLI Mint On Devnet'}</button>
                <button onClick={mintWithPhantom} disabled={status === 'loading' || artifactDemoMode} className="rounded-full bg-fuchsia-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60">Mint With Browser Wallet</button>
                <button onClick={warmOracle} disabled={status === 'loading'} className="rounded-full border border-stone-700 bg-stone-900 px-5 py-2 text-sm font-bold text-stone-200 transition hover:border-amber-300/40 disabled:cursor-not-allowed disabled:opacity-60">Warm Oracle</button>
                <button onClick={warmProofCache} disabled={status === 'loading'} className="rounded-full border border-stone-700 bg-stone-900 px-5 py-2 text-sm font-bold text-stone-200 transition hover:border-amber-300/40 disabled:cursor-not-allowed disabled:opacity-60">Warm Proof</button>
              </div>
              {artifactDemoMode && (
                <p className="mt-4 text-sm leading-6 text-amber-200">
                  Demo mode is pinned to a precomputed Groth16 artifact on Railway. Browser-wallet mint is disabled so the public demo stays stable.
                </p>
              )}
            </article>

            <aside className="grid gap-6">
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Operator Brief</p>
                <div className="mt-4 grid gap-4 text-sm text-stone-300">
                  <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Institution</p>
                    <p className="mt-2 font-mono text-stone-100">{compactHash(institution?.institution_id_hash)}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Permit</p>
                    <p className="mt-2 font-mono text-stone-100">{compactHash(permit?.nullifier_hash)}</p>
                    <p className="mt-1 text-stone-400">Travel Rule {compactHash(permit?.travel_rule_ref_hash)}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-stone-800 bg-stone-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Latest Signature</p>
                    <p className="mt-2 font-mono text-stone-100">{compactHash(latestMintSignature)}</p>
                  </div>
                </div>
              </article>

              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Latest Response</p>
                <pre className="mt-4 min-h-[16rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {response || 'No proof or mint response yet.'}
                </pre>
              </article>
            </aside>
          </section>
        )}

        {activeView === 'advanced' && (
          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Advanced Desk</p>
                  <h2 className="mt-2 text-2xl font-bold text-stone-50">Raw Payload + Debug Surface</h2>
                </div>
                <button onClick={submitProof} disabled={status === 'loading'} className="rounded-full bg-cyan-300 px-5 py-2 text-sm font-bold text-stone-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">
                  {artifactDemoMode ? 'Fetch Demo Proof' : 'Generate Proof'}
                </button>
              </div>
              <textarea
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                disabled={artifactDemoMode}
                className="mt-5 min-h-[32rem] w-full rounded-[1.5rem] border border-stone-800 bg-stone-950/80 p-4 font-mono text-xs leading-6 text-stone-200 outline-none ring-0"
                spellCheck={false}
              />
              {artifactDemoMode && (
                <p className="mt-4 text-sm leading-6 text-amber-200">
                  Advanced proof input is locked in artifact demo mode. The server returns the pinned demo proof bundle to avoid prover-input drift.
                </p>
              )}
            </article>

            <aside className="grid gap-6">
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-stone-500">Health</p>
                <pre className="mt-4 overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {JSON.stringify(health, null, 2)}
                </pre>
              </article>
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300/80">Compliance Snapshot</p>
                <pre className="mt-4 min-h-[12rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {complianceState || 'No compliance state loaded yet.'}
                </pre>
              </article>
              <article className="rounded-[2rem] border border-stone-800 bg-stone-900/70 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300/80">Response</p>
                <pre className="mt-4 min-h-[12rem] overflow-auto rounded-[1.25rem] bg-stone-950/80 p-4 text-xs leading-6 text-stone-200">
                  {response || 'No response yet.'}
                </pre>
              </article>
            </aside>
          </section>
        )}

        <article className="rounded-[2rem] border border-red-500/20 bg-red-950/20 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-300/80">Error</p>
          <p className="mt-4 text-sm leading-6 text-red-200">{error || 'No errors.'}</p>
        </article>
      </div>
    </div>
  )
}

export default App
