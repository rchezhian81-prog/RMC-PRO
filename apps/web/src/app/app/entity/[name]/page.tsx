'use client';

import { useParams } from 'next/navigation';
import { ENTITY_CONFIG } from '../../../../lib/entity-config';
import { MasterCrud } from '../../../../components/MasterCrud';

export default function EntityPage() {
  const { name } = useParams<{ name: string }>();
  const config = ENTITY_CONFIG[name];
  if (!config) return <p>Unknown entity: {name}</p>;
  return <MasterCrud config={config} />;
}
