import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<App />);

// Hand off from the instant static boot screen (in index.html) to the React
// splash once the app has actually mounted — no white flash, no double wait.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 360);
  });
});
