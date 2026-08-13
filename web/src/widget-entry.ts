import { mountWidget } from "./widget.js";
import cssText from "./widget.css";

function injectCss(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

injectCss(cssText);

try {
  mountWidget();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  document.body.innerHTML = `<p style="padding:16px;color:#ff6b6b;font:14px/1.4 sans-serif">Error al cargar el widget Pokémon: ${message}</p>`;
  console.error("mountWidget failed", error);
}
