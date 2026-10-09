import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  LoaderCircle,
  Sparkles,
  Activity,
  X,
} from "lucide-react";
import type { Context } from "../api/types";
export function Busy({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="busy">
      <LoaderCircle className="spin" size={18} />
      {text}
    </div>
  );
}
/** Placeholder blocks shown while a list or dashboard loads. */
export function Skeleton({ rows = 3, height = 92 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-block" key={i} style={{ height, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
export function ErrorNotice({
  message,
  onClose,
}: {
  message: string;
  onClose?: () => void;
}) {
  return message ? (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {onClose && (
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Dismiss error"
        >
          <X size={16} />
        </button>
      )}
    </div>
  ) : null;
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <BookOpen size={28} />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Integrations({
  context,
  compact = false,
}: {
  context: Context | null;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "integration-list" : "integration-grid"}>
      {[
        {
          code: "C01",
          title: "Learner profile",
          detail: context
            ? `${context.c01.mastery}% mastery · ${context.c01.confidence}% confidence`
            : "Prior knowledge & starting point",
          sub: context
            ? `Starting difficulty: ${context.c01.starting_difficulty}`
            : "An informed place to begin",
          icon: <Sparkles size={17} />,
        },
        {
          code: "C02",
          title: "Learning signals",
          detail: context
            ? `Cognitive load: ${context.c02.cognitive_load}`
            : "Context for an adaptive pace",
          sub: context
            ? `Engagement: ${context.c02.engagement}`
            : "Supplementary context, never a diagnosis",
          icon: <Activity size={17} />,
        },
        {
          code: "C03",
          title: "Course knowledge",
          detail: context
            ? `${context.c03.chunks.length} source passages available`
            : "Grounded in course material",
          sub: context
            ? context.c03.course_id
            : "Approved concepts & review resources",
          icon: <BookOpen size={17} />,
        },
      ].map((item) => (
        <div className="integration-card" key={item.code}>
          <div className="integration-top">
            <span className="code-tag">{item.code}</span>
            {item.icon}
          </div>
          <h3>{item.title}</h3>
          <p>{item.detail}</p>
          <small>{item.sub}</small>
        </div>
      ))}
    </div>
  );
}
export function ResourceLink({ title, url }: { title: string; url?: string }) {
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : undefined;
  return safeUrl ? (
    <a className="resource" href={safeUrl} target="_blank" rel="noreferrer">
      <BookOpen size={17} />
      {title}
      <ArrowUpRight size={15} />
    </a>
  ) : (
    <div className="resource">
      <BookOpen size={17} />
      {title}
      <ChevronRight size={15} />
    </div>
  );
}
export function Steps({ active = 1 }: { active?: number }) {
  return (
    <div className="steps">
      {["Prepare", "Discuss", "Reflect"].map((x, i) => (
        <div
          key={x}
          className={active === i + 1 ? "active" : active > i + 1 ? "done" : ""}
        >
          <span>
            {active > i + 1 ? (
              <Check size={12} />
            ) : (
              String(i + 1).padStart(2, "0")
            )}
          </span>
          {x}
        </div>
      ))}
    </div>
  );
}

export function integrationLabel(context: Context | null) {
  if (!context) return "Loading context";
  if (context.c03.source.startsWith('local uploaded')) return 'Uploaded course · learner signals unavailable';
  const count = [
    context.c01.source,
    context.c02.source,
    context.c03.source,
  ].filter((source) => source.toLowerCase().includes("mock")).length;
  return count === 3
    ? "Sample integrations"
    : count
      ? "Live + sample integrations"
      : "Connected integrations";
}
