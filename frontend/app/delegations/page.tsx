'use client';

import DaoList from '@/components/DaoList';

/** /delegations — same DAO list as /proposals, but rows land on each
 *  DAO's delegations view. */
export default function DelegationDaosPage() {
  return <DaoList hrefFor={(dao) => `/proposals/${dao.id}?view=delegations`} />;
}
