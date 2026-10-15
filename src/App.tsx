import { ChartPanel } from "./components/ChartPanel.tsx";
import { FeedControls } from "./components/FeedControls.tsx";
import { Header } from "./components/Header.tsx";
import { PerfPanel } from "./components/PerfPanel.tsx";

export function App() {
  return (
    <div className="app">
      <Header />
      <main className="layout">
        <div className="col-main">
          <ChartPanel />
          <FeedControls />
        </div>
        <div className="col-side">
          <PerfPanel />
        </div>
      </main>
    </div>
  );
}
