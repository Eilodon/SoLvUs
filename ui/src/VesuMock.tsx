import React from 'react';

interface VesuMockProps {
  starknetAddress: string | null;
  badges: Array<{ type: number; tier: number }>;
}

const VesuMock: React.FC<VesuMockProps> = ({ starknetAddress, badges }) => {
  const getQualifyingOffers = () => {
    if (!starknetAddress || badges.length === 0) return null;

    const offers = [];
    
    // Check Whale Badges
    const whaleBadge = badges.find(b => b.type === 1);
    if (whaleBadge) {
      if (whaleBadge.tier >= 3) {
        offers.push("🔥 VIP Lending Rate: 0.5% APR reduction");
      } else {
        offers.push("✅ Standard Whale Discount: 0.2% APR reduction");
      }
    }

    // Check Hodler Badges
    const hodlerBadge = badges.find(b => b.type === 2);
    if (hodlerBadge && hodlerBadge.tier >= 2) {
      offers.push("💎 Diamond Hands: +5% LTV on BTC collateral");
    }

    // Check Stacker Badges
    const stackerBadge = badges.find(b => b.type === 3);
    if (stackerBadge) {
      offers.push("📦 Batch Transaction Rebate: 50% gas refund");
    }

    return offers;
  };

  const offers = getQualifyingOffers();

  return (
    <div className="mt-8 p-6 rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/50">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center border border-orange-500/50">
          <span className="text-orange-500 font-bold text-xs">V</span>
        </div>
        <h3 className="text-lg font-bold text-slate-200">Mock Vesu Integration</h3>
      </div>

      {!starknetAddress ? (
        <p className="text-slate-500 italic">Connect wallet to see your Vesu benefits.</p>
      ) : !offers || offers.length === 0 ? (
        <p className="text-slate-500 italic">You don't have any Solvus Badges yet. Mint one to unlock DeFi benefits!</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Based on your Solvus Badges, you qualify for:</p>
          <ul className="space-y-2">
            {offers.map((offer, i) => (
              <li key={i} className="text-sm font-medium text-emerald-400 flex items-center gap-2">
                <span>•</span>
                {offer}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default VesuMock;
