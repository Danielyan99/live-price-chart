import { ChartPanel } from "./components/ChartPanel.tsx";
import { DepthPanel } from "./components/DepthPanel.tsx";
import { FeedControls } from "./components/FeedControls.tsx";
import { Header } from "./components/Header.tsx";
import { PerfPanel } from "./components/PerfPanel.tsx";
import { ReplayBar } from "./components/ReplayBar.tsx";
import { TradesPanel } from "./components/TradesPanel.tsx";

export function App() {
  return (
    <div className="app">
      <Header />
      <main className="layout">
        <div className="col-main">
          <ChartPanel />
          <ReplayBar />
          <div className="row-2">
            <DepthPanel />
            <FeedControls />
          </div>
        </div>
        <div className="col-side">
          <PerfPanel />
          <TradesPanel />
        </div>
      </main>
    </div>
  );
}
