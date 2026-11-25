import { notFound } from 'next/navigation';
import DevTables from './DevTables';

export const metadata = { title: 'Table previews | Pixel Pot' };

/** Dev-only gallery of fake tables for checking the table layout. 404 in production. */
export default function DevTablePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevTables />;
}
