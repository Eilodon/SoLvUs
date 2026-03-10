import React, { useState, useEffect } from 'react';
import { Landmark, AlertCircle, CheckCircle } from 'lucide-react';

interface VesuMockProps {
  userAddress: string;
  hasBadge: boolean;
}

export const VesuMock: React.FC<VesuMockProps> = ({ userAddress, hasBadge }) => {
  const [eligibility, setEligibility] = useState<{ eligible: boolean; discount: string } | null>(null);

  useEffect(() => {
    if (hasBadge) {
      setEligibility({ eligible: true, discount: '0.5% Interest Discount Applied' });
    } else {
      setEligibility({ eligible: false, discount: 'Standard Rates' });
    }
  }, [hasBadge]);

  return (
    <div className="card" style={{ marginTop: '2rem', borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Landmark className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        <div>
          <h3 style={{ color: '#fff' }}>Vesu Lending Protocol</h3>
          <p style={{ fontSize: '0.8rem' }}>Connected: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}</p>
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px' }}>
        {hasBadge ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <CheckCircle className="w-5 h-5" style={{ color: 'var(--success)' }} />
            <div>
              <p style={{ color: 'var(--success)', fontWeight: 'bold' }}>Solvus Badge Detected</p>
              <p style={{ fontSize: '0.9rem' }}>{eligibility?.discount}</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <AlertCircle className="w-5 h-5" style={{ color: 'var(--text-dim)' }} />
            <div>
              <p>No Solvus Badge Found</p>
              <p style={{ fontSize: '0.8rem' }}>Mint a Solvus Badge to unlock premium lending rates.</p>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
        <button className="btn btn-outline" style={{ flex: 1, fontSize: '0.8rem' }}>Deposit Collateral</button>
        <button className="btn btn-primary" style={{ flex: 1, fontSize: '0.8rem', background: 'var(--accent)', color: '#000' }}>Borrow</button>
      </div>
    </div>
  );
};
