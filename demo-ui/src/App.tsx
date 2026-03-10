import React, { useState } from 'react';
import { Shield, Bitcoin, Cpu, Zap, CheckCircle2, Loader2, ArrowRight, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VesuMock } from './VesuMock';

const BADGE_TYPES = [
  { id: 1, name: 'Whale', icon: <Bitcoin className="w-6 h-6" />, description: 'Proof of significant BTC balance' },
  { id: 2, name: 'Hodler', icon: <Shield className="w-6 h-6" />, description: 'Proof of long-term BTC ownership' },
];

const App: React.FC = () => {
  const [step, setStep] = useState(0); // 0: Connect, 1: Select, 2: Proof
  const [selectedBadge, setSelectedBadge] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pstate, setPstate] = useState<string>('Idle');

  const connectWallets = async () => {
    // Mock wallet connection for Demo
    setStep(1);
  };

  const startProofFlow = async () => {
    setIsGenerating(true);
    setPstate('Fetching BTC Relayer Data...');
    await new Promise(r => setTimeout(r, 1500));
    
    setPstate('Signing Identity Challenge...');
    await new Promise(r => setTimeout(r, 1500));

    setPstate('Generating ZK Proof (Nargo Prover)...');
    await new Promise(r => setTimeout(r, 3000));

    setPstate('Minting Badge on Starknet...');
    await new Promise(r => setTimeout(r, 2000));

    setIsGenerating(false);
    setStep(2);
  };

  return (
    <div className="container">
      <header style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <h1>SoLvUs Protocol</h1>
          <p>Privacy-preserving Bitcoin Solvency Badges on Starknet</p>
        </motion.div>
      </header>

      <main>
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div 
              key="step0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="card"
              style={{ textAlign: 'center' }}
            >
              <Wallet className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--primary)' }} />
              <h2>Bridge Your Identity</h2>
              <p style={{ margin: '1rem 0 2rem' }}>Connect your BTC and Starknet wallets to begin the zero-knowledge verification process.</p>
              <button className="btn btn-primary" onClick={connectWallets}>
                Connect Wallets <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="card">
                <h2>Select Badge Tier</h2>
                <div className="tier-grid">
                  {BADGE_TYPES.map(b => (
                    <div 
                      key={b.id} 
                      className={`card tier-card ${selectedBadge === b.id ? 'active' : ''}`}
                      onClick={() => setSelectedBadge(b.id)}
                      style={{ cursor: 'pointer', borderColor: selectedBadge === b.id ? 'var(--primary)' : '' }}
                    >
                      <div className="mb-2" style={{ color: 'var(--primary)' }}>{b.icon}</div>
                      <h3>{b.name}</h3>
                      <p>{b.description}</p>
                    </div>
                  ))}
                </div>

                {selectedBadge && !isGenerating && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '2rem', textAlign: 'center' }}>
                    <button className="btn btn-primary" onClick={startProofFlow}>
                      Generate Proof <Zap className="w-4 h-4" />
                    </button>
                  </motion.div>
                )}

                {isGenerating && (
                  <div className="stepper mt-4">
                    <div className="step active">
                      <div className="step-number">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                      <div>
                        <h3>Processing...</h3>
                        <p>{pstate}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card"
              style={{ textAlign: 'center', borderColor: 'var(--success)' }}
            >
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--success)' }} />
              <h2>Badge Verified!</h2>
              <p style={{ margin: '1rem 0 2rem' }}>Your {selectedBadge === 1 ? 'Whale' : 'Hodler'} badge has been successfully minted on Starknet Sepolia.</p>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '12px', textAlign: 'left', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span>Network</span>
                  <span style={{ color: '#fff' }}>Starknet Sepolia</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Tier</span>
                  <span style={{ color: 'var(--primary)' }}>Tier 2 (0.5 BTC+)</span>
                </div>
              </div>

              <VesuMock userAddress="0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7" hasBadge={true} />

              <button className="btn btn-outline" style={{ marginTop: '2rem' }} onClick={() => setStep(0)}>
                Back to Dashboard
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Vesu Mock Integration Info */}
      <footer style={{ marginTop: '4rem', opacity: 0.5 }}>
        <div className="card" style={{ padding: '1rem 2rem', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Vesu Integration Active</span>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <span>Starknet: 0x...dc7</span>
            <span>Garaga: 0x...f3d</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
