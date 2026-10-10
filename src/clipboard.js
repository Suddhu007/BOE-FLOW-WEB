export async function copyText(text, button = null) {
  try {
    await navigator.clipboard.writeText(text);
    notifyCopied(button);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const copied = document.execCommand("copy");
      if (!copied) throw new Error("Clipboard copy failed.");
      notifyCopied(button);
    } finally {
      textarea.remove();
    }
  }
}

function notifyCopied(button) {
  if (!button) return;
  const oldText = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = oldText;
  }, 1300);
}
