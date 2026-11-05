import { useSearchParams } from "react-router";
import { useUser } from "../auth";
import { useTitle } from "../util";
import { AssetsTab } from "./account/AssetsTab";
import { ConfigsTab } from "./account/ConfigsTab";
import { InvitesTab } from "./account/InvitesTab";
import { TokensTab } from "./account/TokensTab";

const TABS = [
  { id: "agent", title: "Агент (MCP)" },
  { id: "assets", title: "Картинки" },
  { id: "configs", title: "Мои конфиги" },
  { id: "invites", title: "Приглашения", admin: true },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AccountPage() {
  useTitle("Кабинет");
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !("admin" in t) || user.role === "admin");
  const wanted = params.get("tab");
  const tab: TabId = tabs.find((t) => t.id === wanted)?.id ?? "agent";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Кабинет</h1>
          <p className="muted">
            {user.login}
            {user.role === "admin" ? " · администратор" : ""}
          </p>
        </div>
      </div>
      <div className="tabs tabs-page" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setParams(t.id === "agent" ? {} : { tab: t.id }, { replace: true })}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "agent" && <TokensTab />}
        {tab === "assets" && <AssetsTab />}
        {tab === "configs" && <ConfigsTab />}
        {tab === "invites" && user.role === "admin" && <InvitesTab />}
      </div>
    </div>
  );
}
