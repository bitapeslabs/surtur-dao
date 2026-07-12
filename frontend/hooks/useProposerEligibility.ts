'use client';

/**
 * useProposerEligibility — can the connected wallet open a proposal for
 * this DAO right now? Resolves the proposal-threshold fork entry at the
 * current tip and compares the wallet's voting-token share (one batched
 * espo call, cached against the tip like every other espo query).
 *
 * Gates the "New proposal" buttons AND the create page's submit — surtur
 * nodes re-enforce the same rule on POST, so this is UX, not security.
 */

import { useQuery } from '@tanstack/react-query';
import {
  delegationMembersAt,
  resolveThreshold,
  thresholdPower,
  type ThresholdSchedule,
} from '@surtur/shared';
import { getDaoStore } from '@/lib/dao/store';
import type { DaoDefinition } from '@/daos';
import { useVendorWallet } from '@/context/VendorWalletContext';
import { useEspoHeight } from '@/hooks/useEspoHeight';
import { fetchProposerShare } from '@/lib/dao/governance';

export interface ProposerEligibility {
  /** False while checking — the buttons stay locked until proven. */
  eligible: boolean;
  /** True while the share is being fetched. */
  checking: boolean;
  /** Threshold pctg in force at the current tip. */
  requiredPct: number;
  /** The wallet's share in percent (null when unknown / not needed). */
  heldPct: number | null;
  /** Absolute voting-token amount (base units) required, when known. */
  requiredAmount: bigint | null;
}

export function useProposerEligibility(
  dao: DaoDefinition | null,
  /** Which threshold schedule to gate on — proposals by default; pass
   *  dao.delegatorThreshold for the create-delegation flow. */
  schedule?: ThresholdSchedule,
): ProposerEligibility {
  const { session } = useVendorWallet();
  const address = session?.account.address ?? null;
  const { data: tipData } = useEspoHeight(dao?.espoNetwork);
  const tip = tipData ?? null;

  const activeSchedule = schedule ?? dao?.proposalThreshold ?? [];
  const requiredPct = dao
    ? resolveThreshold(activeSchedule, tip ?? Number.MAX_SAFE_INTEGER)
    : 0;

  // A delegation owner proposes with delegated power — resolve their
  // members at the tip and count those balances toward the share.
  const delegatorsQuery = useQuery({
    queryKey: ['nodes', 'delegators', dao?.id],
    queryFn: () => getDaoStore().listDelegators(dao!.id),
    enabled: !!dao && !!address && requiredPct > 0,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });
  const actionsQuery = useQuery({
    queryKey: ['nodes', 'delegation-actions', dao?.id],
    queryFn: () => getDaoStore().listDelegationActions(dao!.id),
    enabled: !!dao && !!address && requiredPct > 0,
    staleTime: 30_000,
  });
  const ownedDelegatorId =
    (delegatorsQuery.data ?? []).find((b) => b.delegator.delegator === address)?.delegator.id ??
    null;
  const members =
    address && ownedDelegatorId && tip !== null
      ? delegationMembersAt(address, ownedDelegatorId, actionsQuery.data ?? [], tip)
      : [];

  const share = useQuery({
    queryKey: [
      'espo',
      dao?.espoNetwork,
      'proposer-share',
      address,
      tip,
      requiredPct,
      members.join(','),
    ],
    queryFn: () => fetchProposerShare(dao!, address!, members),
    enabled: !!dao && !!address && tip !== null && requiredPct > 0,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
  });

  // No threshold in force, or nobody connected yet (the create page's
  // connect prompt handles that case) — nothing to gate on.
  if (!dao || requiredPct <= 0 || !address) {
    return { eligible: true, checking: false, requiredPct, heldPct: null, requiredAmount: null };
  }

  if (!share.data) {
    return { eligible: false, checking: true, requiredPct, heldPct: null, requiredAmount: null };
  }

  const { supply, held } = share.data;
  const requiredAmount = thresholdPower(supply, requiredPct);
  const eligible = supply > 0n && held >= requiredAmount;
  const heldPct = supply > 0n ? Number((held * 1_000_000n) / supply) / 10_000 : 0;
  return { eligible, checking: false, requiredPct, heldPct, requiredAmount };
}
