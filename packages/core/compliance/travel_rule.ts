import { Hex } from '../contracts';
import { stableJsonHash } from '../shared/utils';

export type IVMS101NaturalPersonNameType = 'LEGL' | 'ALIA' | 'MAID';
export type IVMS101LegalPersonNameType = 'LEGL' | 'SHRT' | 'TRAD';
export type IVMS101NationalIdentifierType =
  | 'LEIX'
  | 'RAID'
  | 'ARNU'
  | 'CCPT'
  | 'SOCS'
  | 'IDCD'
  | 'MISC';

export interface IVMS101GeographicAddress {
  addressType: 'HOME' | 'BIZZ' | 'GEOG';
  streetName?: string;
  buildingNumber?: string;
  townName: string;
  country: string;
  postCode?: string;
}

export interface IVMS101NaturalPerson {
  kind: 'natural_person';
  name: {
    nameIdentifier: Array<{
      primaryIdentifier: string;
      secondaryIdentifier?: string;
      nameIdentifierType: IVMS101NaturalPersonNameType;
    }>;
  };
  geographicAddress?: IVMS101GeographicAddress[];
  nationalIdentification?: {
    nationalIdentifier: string;
    nationalIdentifierType: IVMS101NationalIdentifierType;
  };
  dateAndPlaceOfBirth?: {
    dateOfBirth: string;
    placeOfBirth: string;
  };
}

export interface IVMS101LegalPerson {
  kind: 'legal_person';
  name: {
    nameIdentifier: Array<{
      legalPersonName: string;
      legalPersonNameIdentifierType: IVMS101LegalPersonNameType;
    }>;
  };
  geographicAddress?: IVMS101GeographicAddress[];
  nationalIdentification?: {
    nationalIdentifier: string;
    nationalIdentifierType: 'LEIX' | 'RAID' | 'MISC';
    registrationAuthority?: string;
  };
  legalPersonRegistration?: {
    registrationIdentifier: string;
  };
}

export interface TravelRuleVasp {
  vaspName: string;
  legalEntityIdentifier: string;
  jurisdiction?: string;
}

export interface TravelRuleTransferData {
  transferId: string;
  amount: string;
  assetType: 'BTC';
  settlementAsset: 'zkUSD';
  settlementChain: 'SOLANA';
  timestamp: string;
}

export interface TravelRuleComplianceDecision {
  provider: string;
  decisionRef: string;
  action: 'PASS' | 'ALERT' | 'REJECT';
  timestamp: string;
}

export interface TravelRuleRecord {
  schemaVersion: 'IVMS101-SOLVUS-1';
  originatorVasp: TravelRuleVasp;
  beneficiaryVasp: TravelRuleVasp;
  originator: {
    originatingVaspAccount: string;
    person: IVMS101LegalPerson | IVMS101NaturalPerson;
  };
  beneficiary: {
    beneficiaryVaspAccount: string;
    person: IVMS101LegalPerson | IVMS101NaturalPerson;
  };
  transferData: TravelRuleTransferData;
  complianceDecision: TravelRuleComplianceDecision;
}

export function buildTravelRuleLegalPerson(
  legalPersonName: string,
  legalEntityIdentifier: string,
): IVMS101LegalPerson {
  return {
    kind: 'legal_person',
    name: {
      nameIdentifier: [
        {
          legalPersonName,
          legalPersonNameIdentifierType: 'LEGL',
        },
      ],
    },
    nationalIdentification: {
      nationalIdentifier: legalEntityIdentifier,
      nationalIdentifierType: 'LEIX',
    },
    legalPersonRegistration: {
      registrationIdentifier: legalEntityIdentifier,
    },
  };
}

export function deriveTravelRuleRefHash(record: TravelRuleRecord): Hex {
  return stableJsonHash(record);
}

export function deriveTravelRuleDecisionRefHash(record: TravelRuleRecord): Hex {
  return stableJsonHash({
    schemaVersion: record.schemaVersion,
    originatorVasp: record.originatorVasp,
    beneficiaryVasp: record.beneficiaryVasp,
    transferData: record.transferData,
    complianceDecision: record.complianceDecision,
  });
}
