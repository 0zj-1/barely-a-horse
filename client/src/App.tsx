import { useStore } from './store';
import { Home, Joining } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Draw } from './screens/Draw';
import { Race } from './screens/Race';
import { Results } from './screens/Results';

export function App() {
  const { state, connected, session } = useStore();
  return (
    <>
      {session && !connected && <div className="offline">connection lost… reconnecting</div>}
      <Screen state={state} />
    </>
  );
}

function Screen({ state }: { state: ReturnType<typeof useStore>['state'] }) {
  switch (state) {
    case 'HOME':
      return <Home />;
    case 'JOINING':
      return <Joining />;
    case 'LOBBY':
    case 'READY':
      return <Lobby />;
    case 'DRAWING':
      return <Draw />;
    case 'COUNTDOWN':
    case 'RACING':
      return <Race />;
    case 'RESULTS':
      return <Results />;
  }
}
