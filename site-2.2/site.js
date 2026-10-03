// Copy buttons for every <pre><code> block. No dependencies.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("pre").forEach((pre) => {
    const btn = document.createElement("button");
    btn.className = "copy";
    btn.type = "button";
    btn.textContent = "copy";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.innerText.replace(/^copy\n/, ""));
        btn.textContent = "copied";
        setTimeout(() => (btn.textContent = "copy"), 1200);
      } catch (e) {
        btn.textContent = "select + Ctrl+C";
        setTimeout(() => (btn.textContent = "copy"), 1500);
      }
    });
    pre.appendChild(btn);
  });
});
