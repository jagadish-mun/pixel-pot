import type { Metadata } from 'next';
import PartyRoom from '@/components/PartyRoom';
import { normalizeCode } from '@/lib/game';

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const code = normalizeCode((await params).code);
  return { title: `Table ${code} | Pixel Pot` };
}

export default async function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  return <PartyRoom code={code} />;
}
