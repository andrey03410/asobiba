import { useEffect, useState } from "react";
import { useToast } from "../toast";
import { copyText } from "../util";

interface Props {
  text: string;
  label?: string;
  className?: string;
  /** Toast after copying; nothing when omitted. */
  toast?: string;
}

export function CopyButton({ text, label = "Копировать", className = "btn btn-small", toast }: Props) {
  const [done, setDone] = useState(false);
  const show = useToast();

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);

  const copy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setDone(true);
      if (toast) show(toast, "success");
    } else {
      show("Не получилось скопировать — выделите текст и скопируйте вручную", "error");
    }
  };

  return (
    <button type="button" className={className} onClick={copy}>
      {done ? "Скопировано" : label}
    </button>
  );
}

/** A read-only snippet with a copy button. */
export function CopyBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="copy-block">
      <pre>
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={label} />
    </div>
  );
}
