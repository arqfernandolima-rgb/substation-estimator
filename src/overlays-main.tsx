import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OverlaysApp from "./OverlaysApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode><OverlaysApp /></StrictMode>
);
