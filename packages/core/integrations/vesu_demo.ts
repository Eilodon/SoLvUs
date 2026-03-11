/**
 * This is a demonstration of how Vesu (or any DeFi protocol) can integrate
 * Solvus badges as undercollateralized lending criteria.
 * In production, replace mock calls with actual Vesu SDK integration.
 */

export interface BorrowingPower {
  eligible: boolean;
  maxLTV: number; // loan-to-value ratio (percentage)
  interestRate: string; // display string "8.5% APY"
  tier: string; // "Whale Tier 2" etc
  reason: string; // human readable explanation
}

/**
 * Mocking the Solvus contract interface for the purpose of this demo.
 * In production, this would use starknet.js to call the real contract.
 */
const mockIsBadgeValid = async (
  _borrower: string,
  badgeType: number,
  minTier: number
): Promise<boolean> => {
  // Simulated responses for demo purposes
  // Address '0xWhale' has Whale T3 + Hodler T2
  if (_borrower === '0xWhale') {
    if (badgeType === 1 && minTier <= 3) return true;
    if (badgeType === 2 && minTier <= 2) return true;
  }
  // Address '0xHodler' has Hodler T2 only
  if (_borrower === '0xHodler') {
    if (badgeType === 2 && minTier <= 2) return true;
  }
  // Address '0xNewbie' has Whale T1
  if (_borrower === '0xNewbie') {
    if (badgeType === 1 && minTier <= 1) return true;
  }
  return false;
};

/**
 * Checks the borrowing power of a user based on their Solvus Badges.
 */
export async function checkBorrowingPower(borrower: string): Promise<BorrowingPower> {
  // Check Whale Badges (Type 1)
  const isWhaleT3 = await mockIsBadgeValid(borrower, 1, 3);
  const isWhaleT2 = await mockIsBadgeValid(borrower, 1, 2);
  const isWhaleT1 = await mockIsBadgeValid(borrower, 1, 1);

  // Check Hodler Badges (Type 2)
  const isHodlerT2 = await mockIsBadgeValid(borrower, 2, 2);
  const isHodlerT1 = await mockIsBadgeValid(borrower, 2, 1);

  let maxLTV = 0;
  let baseRate = 0;
  let tierName = "None";
  let eligible = false;

  // 1. Determine base terms from Whale Badge
  if (isWhaleT3) {
    maxLTV = 75;
    baseRate = 7;
    tierName = "Whale Tier 3";
    eligible = true;
  } else if (isWhaleT2) {
    maxLTV = 65;
    baseRate = 9;
    tierName = "Whale Tier 2";
    eligible = true;
  } else if (isWhaleT1) {
    maxLTV = 50;
    baseRate = 12;
    tierName = "Whale Tier 1";
    eligible = true;
  }

  if (!eligible) {
    return {
      eligible: false,
      maxLTV: 0,
      interestRate: "N/A",
      tier: "No Badge",
      reason: "No Solvus Whale Badge detected. Minimum Whale Tier 1 required for borrowing."
    };
  }

  // 2. Apply Hodler Bonus
  let bonus = 0;
  let hodlerContext = "";
  if (isHodlerT2) {
    bonus = 1.0;
    hodlerContext = " + Hodler Tier 2";
  } else if (isHodlerT1) {
    bonus = 0.5;
    hodlerContext = " + Hodler Tier 1";
  }

  const finalRate = baseRate - bonus;
  
  return {
    eligible: true,
    maxLTV,
    interestRate: `${finalRate.toFixed(1)}% APY`,
    tier: tierName + hodlerContext,
    reason: `Verified ${tierName}${hodlerContext} unlocks ${maxLTV}% LTV and reduced interest rates.`
  };
}

/**
 * Formats borrowing terms into a human-readable string.
 */
export function formatBorrowingTerms(power: BorrowingPower): string {
  if (!power.eligible) return power.reason;
  return `As a Verified ${power.tier}, you can borrow up to ${power.maxLTV}% LTV at ${power.interestRate} on Vesu.`;
}

/**
 * Demo call for borrowing on Vesu.
 */
export async function mockVesuBorrow(borrower: string, amount: number): Promise<string> {
  const power = await checkBorrowingPower(borrower);

  if (!power.eligible) {
    console.error(`[Vesu] Access Denied: ${power.reason}`);
    throw new Error(`Insufficient badge tier for this borrow amount: ${amount}`);
  }

  console.log(`[Vesu] Success! Validated Solvus Badge: ${power.tier}`);
  console.log(`[Vesu] Terms: ${formatBorrowingTerms(power)}`);
  
  const mockTxHash = "0x" + Math.random().toString(16).slice(2, 66);
  console.log(`[MOCK ONLY] Borrow Transaction: ${mockTxHash}`);
  console.log("MOCK ONLY — integrate with Vesu SDK for production");
  
  return mockTxHash;
}

// --- Internal Test Runner ---
if (require.main === module) {
  (async () => {
    console.log("--- SOLVUS VESU INTEGRATION DEMO ---");
    
    const addresses = ['0xWhale', '0xHodler', '0xNewbie', '0xStranger'];
    
    for (const addr of addresses) {
      console.log(`\nChecking address: ${addr}`);
      const power = await checkBorrowingPower(addr);
      console.log(formatBorrowingTerms(power));
      
      try {
        if (power.eligible) {
          await mockVesuBorrow(addr, 1000);
        }
      } catch (e: any) {
        console.log(`Borrowing failed: ${e.message}`);
      }
    }
  })();
}
