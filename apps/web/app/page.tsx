import dynamic from 'next/dynamic';

// The game is canvas, WebAudio and localStorage from the first frame. There is nothing
// meaningful to render on the server, and pretending otherwise just buys a hydration bug.
const Game = dynamic(() => import('../components/Game').then((m) => m.Game), { ssr: false });

export default function Page() {
  return <Game />;
}
