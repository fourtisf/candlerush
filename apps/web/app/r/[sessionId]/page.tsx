import type { Metadata } from 'next';
import { ReplayViewer } from '../../../components/ReplayViewer';

/**
 * Watch somebody's run.
 *
 * The one thing this game could not do was produce something a person could send. It
 * already stored the tape for every session and already had an engine that reproduces a
 * run exactly from a seed and a list of button presses — so this page is mostly wiring.
 */
export const metadata: Metadata = {
  title: 'Replay · Candle Rush',
  description: 'Watch a Candle Rush run back, replayed frame for frame from the original inputs.',
};

export default function ReplayPage({ params }: { params: { sessionId: string } }) {
  return <ReplayViewer sessionId={params.sessionId} />;
}
