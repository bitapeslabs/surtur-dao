/**
 * The main orchestrator — surtur nodes bootstrap from here: the
 * whitelisted node list plus every DAO's configuration and thresholds, so
 * nodes can validate incoming proposals/votes themselves. Nodes cache the
 * response locally (MySQL) and keep working if this endpoint goes down.
 */

import { NextResponse } from 'next/server';
import type { OrchestratorInfo } from '@surtur/shared';
import { DAOS } from '@/daos';
import { getEspoUrl } from '@/lib/config';
import { SURTUR_NODES } from '@/surtur.config';

export async function GET() {
  const info: OrchestratorInfo = {
    nodes: SURTUR_NODES,
    daos: DAOS.map((dao) => ({
      id: dao.id,
      name: dao.name,
      enabled: dao.enabled,
      treasuryToken: dao.treasuryToken,
      treasuryAddress: dao.treasuryAddress,
      votingToken: dao.votingToken,
      resolverSigner: dao.resolverSigner,
      proposalThreshold: dao.proposalThreshold,
      votePassThreshold: dao.votePassThreshold,
      delegatorThreshold: dao.delegatorThreshold,
      espoNetwork: dao.espoNetwork,
      espoUrl: getEspoUrl(dao.espoNetwork),
    })),
  };
  return NextResponse.json(info);
}
