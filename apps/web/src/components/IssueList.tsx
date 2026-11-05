import type { ConfigIssue } from "@asobiba/sdk";

function IssueItem({ issue }: { issue: ConfigIssue }) {
  return (
    <li className="issue">
      {issue.path ? <code className="issue-path">{issue.path}</code> : <code className="issue-path">конфиг</code>}
      <span className="issue-message">{issue.message}</span>
      {issue.hint && <span className="issue-hint">{issue.hint}</span>}
    </li>
  );
}

/** Errors and warnings of a config check, errors first. */
export function IssueList({ issues, title }: { issues: readonly ConfigIssue[]; title?: string }) {
  const errors = issues.filter((i) => (i.severity ?? "error") === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (issues.length === 0) return null;
  return (
    <div className="issues">
      {title && <p className="issues-title">{title}</p>}
      {errors.length > 0 && (
        <div className="issues-group issues-errors">
          <p className="issues-label">Ошибки · {errors.length}</p>
          <ul>
            {errors.map((i, k) => (
              <IssueItem key={`e${k}`} issue={i} />
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="issues-group issues-warnings">
          <p className="issues-label">Предупреждения · {warnings.length}</p>
          <ul>
            {warnings.map((i, k) => (
              <IssueItem key={`w${k}`} issue={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
