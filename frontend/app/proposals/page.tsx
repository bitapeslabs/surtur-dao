'use client';

import DaoList from '@/components/DaoList';

export default function DaosPage() {
  return <DaoList hrefFor={(dao) => `/proposals/${dao.id}`} />;
}
