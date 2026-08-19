import LoadMonitor from "../components/LoadMonitor";

export default function Page() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px" }}>
      <LoadMonitor />
    </main>
  );
}
