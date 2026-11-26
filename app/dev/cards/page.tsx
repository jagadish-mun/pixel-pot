import { notFound } from 'next/navigation';
import DevCards from './DevCards';

export const metadata = { title: 'Card faces | Pixel Pot' };

/** Dev-only sheet of every card face, upright and flat. 404 in production. */
export default function DevCardsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevCards />;
}
