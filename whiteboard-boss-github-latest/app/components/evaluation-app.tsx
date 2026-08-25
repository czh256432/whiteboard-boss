"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { defaultSettings, Intern, metrics, newIntern, production, reasons, Settings } from "../lib/evaluation";
import type { SharedData, User } from "../lib/shared-state";
type AdminView = "interns" | "detail" | "projects" | "settings" | "access";
const scoreKeys = [["video", "AI视频"], ["edit", "剪辑"], ["promo", "剧宣"], ["aesthetic", "审美"], ["final", "成片"]] as const;
const help: {
    [k: string]: string;
} = { video: "分镜执行、人物一致性、动作和镜头控制", edit: "剧情理解、节奏、声音与完整成片", promo: "前3秒钩子、卖点提取和传播意识", aesthetic: "构图、光色、风格统一和选片判断", final: "上线质量、交付稳定性和低级错误频率" };
const workTypes = ["剧宣预告", "成片集数", "资产图片", "其他"];
const hash = async (v: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))).map(x => x.toString(16).padStart(2, "0")).join("");
function importLegacyState(cloud: SharedData, viewer: User): SharedData {
    if (viewer.role !== "owner" || cloud.users.length > 1 || cloud.interns.length)
        return cloud;
    try {
        const oldUsers = JSON.parse(localStorage.getItem("frame-users-v1") || "[]") as User[];
        const oldWork = JSON.parse(localStorage.getItem("ai-intern-system-v1") || "null") as { interns?: Intern[]; projects?: string[]; settings?: Settings } | null;
        if (oldUsers.length <= 1 && !oldWork?.interns?.length)
            return cloud;
        const owner = oldUsers.find(user => user.username === "boss_admin") || cloud.users[0];
        const users = [owner, ...oldUsers.filter(user => user.id !== owner.id && user.username !== "boss_admin")].map((user, index) => ({ ...user, role: index === 0 ? "owner" as const : user.role || (user.tag === "管理人" ? "admin" as const : "intern" as const), approved: index === 0 ? true : user.approved ?? true, canManage: index === 0 || user.tag === "管理人", internIds: user.internIds || [], tag: index === 0 || user.tag === "管理人" ? "管理人" as const : "实习生" as const }));
        return { version: 9, users, interns: oldWork?.interns || [], projects: oldWork?.projects?.length ? oldWork.projects : cloud.projects, settings: { ...defaultSettings, ...oldWork?.settings } };
    } catch {
        return cloud;
    }
}
export default function EvaluationApp() {
    const [data, setData] = useState<SharedData | null>(null), [activeId, setActiveId] = useState(""), [ready, setReady] = useState(false), [syncError, setSyncError] = useState("");
    const dirty = useRef(false);
    const updateData: React.Dispatch<React.SetStateAction<SharedData>> = action => {
        dirty.current = true;
        setData(current => {
            if (!current)
                return typeof action === "function" ? action({ version: 9, users: [], interns: [], projects: [], settings: defaultSettings }) : action;
            return typeof action === "function" ? action(current) : action;
        });
    };
    useEffect(() => {
        fetch("/api/session").then(async response => {
            if (!response.ok)
                return;
            const payload = await response.json();
            const next = importLegacyState(payload.state, payload.user);
            if (next !== payload.state)
                dirty.current = true;
            setData(next);
            setActiveId(payload.user.id);
        }).finally(() => setReady(true));
    }, []);
    useEffect(() => {
        if (!data || !activeId || !dirty.current)
            return;
        const timer = window.setTimeout(async () => {
            dirty.current = false;
            const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
            setSyncError(response.ok ? "" : (await response.json()).error || "云端保存失败");
        }, 350);
        return () => window.clearTimeout(timer);
    }, [data, activeId]);
    useEffect(() => {
        if (!activeId)
            return;
        const timer = window.setInterval(async () => {
            if (dirty.current || document.hidden)
                return;
            const response = await fetch("/api/session");
            if (response.ok) {
                const payload = await response.json();
                setData(payload.state);
            }
        }, 8000);
        return () => window.clearInterval(timer);
    }, [activeId]);
    const active = data?.users.find(u => u.id === activeId);
    const login = (payload: { user: User; state: SharedData }) => { const next = importLegacyState(payload.state, payload.user); if (next !== payload.state)
        dirty.current = true; setData(next); setActiveId(payload.user.id); };
    const logout = async () => { await fetch("/api/logout", { method: "POST" }); setActiveId(""); setData(null); };
    if (!ready)
        return null;
    if (!active)
        return <AuthScreen login={login}/>;
    if (!active.approved)
        return <PendingAccess user={active} logout={logout}/>;
    return <Workspace user={active} data={data!} setData={updateData} acceptServerData={next => { dirty.current = false; setData(next); }} logout={logout} syncError={syncError}/>;
}
function Workspace({ user, data, setData, acceptServerData, logout, syncError }: {
    user: User;
    data: SharedData;
    setData: React.Dispatch<React.SetStateAction<SharedData>>;
    acceptServerData: (data: SharedData) => void;
    logout: () => void;
    syncError: string;
}) {
    const { users, interns, projects, settings } = data;
    const updateSlice = <K extends keyof SharedData>(key: K): React.Dispatch<React.SetStateAction<SharedData[K]>> => action => setData(current => ({ ...current, [key]: typeof action === "function" ? (action as (value: SharedData[K]) => SharedData[K])(current[key]) : action }));
    const setUsers = updateSlice("users"), setInterns = updateSlice("interns"), setProjects = updateSlice("projects"), setSettings = updateSlice("settings");
    const [mode, setMode] = useState<"tasks" | "manage">("tasks"), [adminView, setAdminView] = useState<AdminView>("interns"), [selected, setSelected] = useState(""), [showAccount, setShowAccount] = useState(false), [modal, setModal] = useState<"intern" | "evaluation" | "problem" | null>(null);
    const isManager = user.role === "owner" || user.canManage, isOwner = user.role === "owner";
    const assigned = interns.filter(i => user.internIds.includes(i.id)), self = assigned[0] || interns.find(i => i.name === user.name), managed = isOwner ? interns : user.canManage ? assigned : self ? [self] : [];
    const ranked = useMemo(() => [...managed].sort((a, b) => { const ma = metrics(a, settings), mb = metrics(b, settings); if (ma.unrated !== mb.unrated)
        return ma.unrated ? 1 : -1; return mb.retention - ma.retention; }), [managed, settings]);
    const current = managed.find(i => i.id === selected) || managed[0], today = new Date().toISOString().slice(0, 10), alreadyScored = !!current?.evaluations.some(e => e.date === today), canScore = !!current && (isOwner || user.canManage && user.internIds.includes(current.id)) && !alreadyScored;
    const open = (id: string) => { setSelected(id); setAdminView("detail"); };
    const remove = () => { if (current && confirm(`确定删除“${current.name}”及其全部记录吗？`)) {
        setInterns(xs => xs.filter(i => i.id !== current.id));
        setAdminView("interns");
    } };
    const create = (i: Intern) => { setInterns(xs => [...xs, i]); setSelected(i.id); setModal(null); setAdminView("detail"); };
    return <div className="wb-shell"><header className="wb-topbar"><div className="wb-brand"><div className="bossmark"><i /><i /></div><div><b>白板BOSS</b><span>WHITEBOARD BOSS</span></div></div><div className="mode-switch"><button className={mode === "tasks" ? "active" : ""} onClick={() => setMode("tasks")}>任务白板</button>{isManager && <button className={mode === "manage" ? "active" : ""} onClick={() => setMode("manage")}>管理界面</button>}</div><button className="user-pill" onClick={() => setShowAccount(true)}><UserAvatar user={user}/><span><b>{user.name}</b><small>{user.tag}</small></span></button></header>{syncError && <div className="sync-error">云端同步暂时失败：{syncError}</div>}
 <main className="wb-main">{mode === "tasks" ? <CalendarBoard interns={managed} projects={projects} fixedIntern={!isManager || managed.length <= 1} initialId={self?.id} setInterns={setInterns}/> : <><div className="admin-head"><div><span>MANAGEMENT</span><h1>{isOwner ? "人员管理" : "我的实习生"}</h1></div><nav><button className={adminView === "interns" || adminView === "detail" ? "active" : ""} onClick={() => setAdminView("interns")}>实习生</button><button className={adminView === "projects" ? "active" : ""} onClick={() => setAdminView("projects")}>项目库</button>{isOwner && <button className={adminView === "settings" ? "active" : ""} onClick={() => setAdminView("settings")}>评分设置</button>}{isOwner && <button className={adminView === "access" ? "active" : ""} onClick={() => setAdminView("access")}>账号授权</button>}</nav></div>{adminView === "interns" && <InternHub interns={ranked} users={users} setInterns={setInterns} settings={settings} open={open} add={isOwner ? () => setModal("intern") : undefined}/>} {adminView === "detail" && current && <Detail intern={current} settings={settings} rank={ranked.findIndex(i => i.id === current.id) + 1} total={ranked.length} back={() => setAdminView("interns")} addEvaluation={canScore ? () => setModal("evaluation") : undefined} scoredToday={alreadyScored} addProblem={() => setModal("problem")} remove={remove}/>} {adminView === "projects" && <ProjectPanel projects={projects} setProjects={setProjects}/>} {adminView === "settings" && isOwner && <SettingsPanel value={settings} change={setSettings}/>} {adminView === "access" && isOwner && <AccessPanel users={users} interns={interns} acceptServerData={acceptServerData}/>}</>}</main>
 {modal && <AdminModal kind={modal} current={current} evaluator={user.name} close={() => setModal(null)} setInterns={setInterns} created={create}/>} {showAccount && <AccountPanel user={user} setUsers={setUsers} close={() => setShowAccount(false)} logout={logout}/>}</div>;
}
function CalendarBoard({ interns, projects, fixedIntern, initialId, setInterns }: {
    interns: Intern[];
    projects: string[];
    fixedIntern: boolean;
    initialId?: string;
    setInterns: React.Dispatch<React.SetStateAction<Intern[]>>;
}) {
    const [personId, setPersonId] = useState(initialId || interns[0]?.id || ""), [month, setMonth] = useState("2026-08"), [selectedDate, setSelectedDate] = useState("2026-08-24"), [adding, setAdding] = useState(false);
    useEffect(() => { if (fixedIntern && initialId && interns.some(i => i.id === initialId))
        setPersonId(initialId);
    else if (!interns.some(i => i.id === personId))
        setPersonId(interns[0]?.id || ""); }, [fixedIntern, initialId, interns, personId]);
    const person = interns.find(i => i.id === personId), tasks = person?.tasks || [];
    const days = useMemo(() => { const [y, m] = month.split("-").map(Number), first = new Date(y, m - 1, 1), count = new Date(y, m, 0).getDate(), lead = (first.getDay() + 6) % 7; return Array.from({ length: 42 }, (_, n) => { const day = n - lead + 1; return day < 1 || day > count ? null : `${month}-${String(day).padStart(2, "0")}`; }); }, [month]);
    const shift = (delta: number) => { const [y, m] = month.split("-").map(Number), d = new Date(y, m - 1 + delta, 1), next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; setMonth(next); setSelectedDate(next + "-01"); };
    const dayTasks = tasks.filter(t => t.date === selectedDate);
    const add = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); if (!person)
        return; const d = new FormData(e.currentTarget), category = String(d.get("category")), task = { id: crypto.randomUUID(), date: String(d.get("date")), title: category, project: String(d.get("project")), category, passed: true, generated: Number(d.get("generated")), usable: Number(d.get("usable")) }; setInterns(xs => xs.map(i => i.id === person.id ? { ...i, tasks: [...i.tasks, task] } : i)); setSelectedDate(task.date); setMonth(task.date.slice(0, 7)); setAdding(false); };
    if (!person)
        return <section className="blank-state"><div>＋</div><h2>还没有绑定实习生档案</h2><p>请让管理员主号在“账号授权”中把你的账号绑定到实习生。</p></section>;
    return <><section className="calendar-head"><div><span>MY WORK CALENDAR</span><h1>{fixedIntern ? "记录我的工作" : "团队任务白板"}</h1><p>项目由管理员维护；工作类别分为剧宣预告、成片集数、资产图片和其他。</p></div><div className="calendar-actions">{!fixedIntern && <select value={personId} onChange={e => setPersonId(e.target.value)}>{interns.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}<button className="primary" onClick={() => setAdding(true)}>＋ 记录工作</button></div></section><section className="work-type-legend">{workTypes.map(type => <span key={type} style={categoryStyle(type)}>{type}</span>)}</section><section className="calendar-layout"><div className="calendar-card"><div className="month-nav"><button onClick={() => shift(-1)}>←</button><b>{month.replace("-", " 年 ")} 月</b><button onClick={() => shift(1)}>→</button></div><div className="week-row">{["一", "二", "三", "四", "五", "六", "日"].map(x => <span key={x}>{x}</span>)}</div><div className="month-grid">{days.map((date, index) => date ? <button key={date} className={`${date === selectedDate ? "selected" : ""} ${tasks.some(t => t.date === date) ? "has-task" : ""}`} onClick={() => setSelectedDate(date)}><span>{Number(date.slice(-2))}</span><div>{Array.from(new Set(tasks.filter(t => t.date === date).map(t => t.project))).map(project => <i key={project} style={projectStyle(project)}>{project}</i>)}</div></button> : <div className="calendar-empty" key={index}/>)}</div></div><aside className="day-panel"><span>SELECTED DAY</span><h2>{selectedDate.slice(5).replace("-", " 月 ")} 日</h2><div className="day-task-list">{dayTasks.length ? dayTasks.map(t => <article key={t.id} style={{ borderLeftColor: projectStyle(t.project).color }}><div className="task-meta"><em style={{ color: projectStyle(t.project).color }}>{t.project}</em><i style={categoryStyle(t.category)}>{t.category}</i></div><div><small>完成 {t.generated} · 通过 {t.usable}</small></div></article>) : <div className="quiet-empty">这一天还没有记录。</div>}</div><button className="soft-button" onClick={() => setAdding(true)}>＋ 添加工作记录</button></aside></section>{adding && <div className="modal-back"><form className="modal compact-modal" onSubmit={add}><ModalHead title={`记录 ${person.name} 的工作`} close={() => setAdding(false)}/><Field name="date" label="日期" type="date" value={selectedDate}/><label>归属项目<select required name="project" defaultValue={projects[0] || ""}><option value="" disabled>请选择管理员添加的项目</option>{projects.map(p => <option key={p}>{p}</option>)}</select></label><label>工作类别<select required name="category" defaultValue="成片集数">{workTypes.map(type => <option key={type}>{type}</option>)}</select></label><div className="form-grid"><Field name="generated" label="完成数量" type="number" value="10"/><Field name="usable" label="通过数量" type="number" value="7"/></div><ModalActions close={() => setAdding(false)}/></form></div>}</>;
}
function InternHub({ interns, users, setInterns, settings, open, add }: {
    interns: Intern[];
    users: User[];
    setInterns: React.Dispatch<React.SetStateAction<Intern[]>>;
    settings: Settings;
    open: (id: string) => void;
    add?: () => void;
}) { const rated = interns.filter(i => !metrics(i, settings).unrated), today = new Date().toISOString().slice(0, 10), updated = interns.filter(i => i.evaluations.some(e => e.date === today)).length, managers = users.filter(u => u.tag === "管理人" && u.approved), toggleMentor = (intern: Intern, name: string) => setInterns(xs => xs.map(i => i.id === intern.id ? { ...i, mentors: i.mentors.includes(name) ? i.mentors.filter(x => x !== name) : [...i.mentors, name], mentor: i.mentors.includes(name) ? i.mentors.filter(x => x !== name).join("、") : [...i.mentors, name].join("、") } : i)); return <><section className="hub-summary clean-hub"><div><span>实习生</span><b>{interns.length}</b></div><div><span>已经评分</span><b>{rated.length}</b></div><div><span>今日已更新</span><b>{updated}</b></div>{add && <button className="primary" onClick={add}>＋ 新增实习生</button>}</section><section className="panel people-panel"><div className="section-title"><div><span>RANKING & SCORE</span><h2>实习生排名与评分</h2><p>指导人可从标签为“管理人”的账号中多选；负分扣分会用红色突出显示。</p></div></div><div className="people-table"><div className="people-row people-th"><span>排名</span><span>实习生</span><span>指导人（可多选）</span><span>最新评分</span><span>综合评分</span><span>问题扣分</span><span>留用等级</span><span>是否建议留用</span></div>{interns.map((i, index) => { const m = metrics(i, settings); return <div className="people-row people-data-row" key={i.id} onClick={() => open(i.id)}><strong>{m.unrated ? "—" : String(index + 1).padStart(2, "0")}</strong><span className="person-cell"><Avatar i={i}/><b>{i.name}<small>{i.evaluations.length} 次评分</small></b></span><div className="mentor-multi" onClick={e => e.stopPropagation()}>{managers.length ? managers.map(u => <label key={u.id} className={i.mentors.includes(u.name) ? "selected" : ""}><input type="checkbox" checked={i.mentors.includes(u.name)} onChange={() => toggleMentor(i, u.name)}/>{u.name}</label>) : <small>暂无管理人</small>}</div><span>{m.unrated ? "待评分" : m.prod.toFixed(1)}</span><span>{m.unrated ? "—" : m.overall.toFixed(1)}</span><strong className={m.penalty ? "penalty-score" : ""}>{m.unrated ? "—" : m.penalty ? `-${m.penalty.toFixed(1)}` : "0"}</strong><Grade g={m.grade}/><Status yes={!m.unrated && m.eligible} pending={m.unrated}/></div>; })}</div></section></>; }
function Detail({ intern, settings, rank, total, back, addEvaluation, scoredToday, addProblem, remove }: {
    intern: Intern;
    settings: Settings;
    rank: number;
    total: number;
    back: () => void;
    addEvaluation?: () => void;
    scoredToday: boolean;
    addProblem?: () => void;
    remove?: () => void;
}) { const m = metrics(intern, settings); return <><button className="back-button" onClick={back}>← 返回实习生</button><section className="profile-hero minimal-profile"><Avatar i={intern}/><div><span>INTERN PROFILE</span><h1>{intern.name} <Grade g={m.grade}/></h1><p>{intern.role} · 入职 {intern.startDate} · 指导人 {intern.mentors.length ? intern.mentors.join("、") : "未绑定"}</p></div><div className="profile-metrics"><div><span>当前排名</span><b>{m.unrated ? "—" : `${rank}/${total}`}</b></div><div><span>最新评分</span><b>{m.unrated ? "—" : m.prod.toFixed(1)}</b></div><div><span>综合评分</span><b>{m.unrated ? "—" : m.overall.toFixed(1)}</b></div><div><span>问题扣分</span><b className={m.penalty ? "penalty-score" : ""}>{m.unrated ? "—" : m.penalty ? `-${m.penalty.toFixed(1)}` : "0"}</b></div><Status yes={m.eligible} pending={m.unrated}/></div></section><section className="score-action panel"><div><span>DAILY SCORE</span><h2>今日评分</h2><p>{scoredToday ? "今天已经由一位归属管理员完成评分，明天可再次更新。" : "同一实习生每天只能评分一次，提交后将进入成长曲线。"}</p></div>{addEvaluation ? <button className="primary" onClick={addEvaluation}>＋ 进行今日评分</button> : <span className="done-today">{scoredToday ? "今日已完成" : "无评分权限"}</span>}</section>{m.unrated ? <section className="panel blank-state"><h2>等待首次统一评估</h2><p>完成首次评分后才生成评级、排名和留用判断。</p></section> : <RatedDetail intern={intern} settings={settings} m={m}/>}<section className="panel problem-panel"><div className="section-title split"><div><span>ERROR MEMORY</span><h2>问题复发与扣分</h2></div>{addProblem && <button className="soft-button" onClick={addProblem}>＋ 记录问题</button>}</div>{intern.problems.length ? intern.problems.map(p => <div className="problem" key={p.id}><span className={`severity ${p.severity}`}>{p.severity}</span><div><b>{p.title}</b><small>{p.type}</small></div><strong>重复 ×{p.repeats}</strong></div>) : <div className="quiet-empty">暂无问题记录</div>}{remove && <button className="danger-button" onClick={remove}>删除实习生</button>}</section></>; }
function RatedDetail({ intern, settings, m }: {
    intern: Intern;
    settings: Settings;
    m: ReturnType<typeof metrics>;
}) { const first = intern.evaluations[0], last = intern.evaluations.at(-1)!; return <><section className="panel trend-panel"><div className="section-title split"><div><span>PROGRESS TREND</span><h2>每日评分进步曲线</h2><p>纵轴为生产评分，横轴按评分日期排列。</p></div><b className="trend-delta">{m.prod >= m.baseProd ? "+" : ""}{(m.prod - m.baseProd).toFixed(1)}</b></div><TrendChart evaluations={intern.evaluations}/></section><section className="detail-columns"><div className="panel"><div className="section-title"><span>BASELINE → TODAY</span><h2>五项能力变化</h2></div><div className="skill-chart">{scoreKeys.map(([k, l]) => <div key={k}><span>{l}</span><div><i className="base" style={{ width: `${first.scores[k]}%` }}/><i className="now" style={{ width: `${last.scores[k]}%` }}/></div><b>{first.scores[k]} → {last.scores[k]}</b></div>)}</div></div><div className="panel decision-card"><div className="section-title split"><div><span>RETENTION REPORT</span><h2>留用小报告</h2></div><Status yes={m.eligible}/></div><p className="report-summary">依据当前最低留用指数 <strong>{settings.minRetention} 分</strong>，结论为<strong>{m.eligible ? "建议留用" : "暂不留用"}</strong>，留用等级同步调整为 <Grade g={m.grade}/></p><ol>{reasons(intern, settings).map(r => <li key={r}>{r}</li>)}</ol></div></section><section className="panel evaluation-history"><div className="section-title split"><div><span>ASSESSMENT LOG</span><h2>评分记录</h2></div><b>{intern.evaluations.length} 次</b></div>{[...intern.evaluations].reverse().map(e => <div className="history-row" key={e.id}><div className="history-index">{e.date.slice(5).replace("-", ".")}</div><div><b>{e.label}</b><span>评分人：{e.evaluator || "未登记"}</span></div><strong>{production(e.scores).toFixed(1)}<small>生产分</small></strong></div>)}</section></>; }
function SettingsPanel({ value, change }: {
    value: Settings;
    change: (v: Settings) => void;
}) { return <><section className="panel settings-panel"><div className="section-title"><span>UNIFIED SCORING</span><h2>统一评分指标</h2><p>所有实习生均使用相同五项生产指标，4分代表达到正式生产要求。</p></div><div className="indicator-grid">{scoreKeys.map(([k, l]) => <div key={k}><b>{l}</b><span>{help[k]}</span></div>)}</div></section><section className="panel settings-panel"><div className="section-title"><span>CALIBRATION</span><h2>最低留用指数</h2><p>人员是否建议留用，只使用这一条最低指数门槛。</p></div><label className="setting-row"><div><b>最低留用指数</b><span>调整后自动重算全部人员</span></div><input type="range" min="0" max="100" value={value.minRetention} onChange={e => change({ minRetention: Number(e.target.value) })}/><strong>{value.minRetention} 分</strong></label></section></>; }
function ProjectPanel({ projects, setProjects }: {
    projects: string[];
    setProjects: React.Dispatch<React.SetStateAction<string[]>>;
}) { const add = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget), name = String(d.get("project")).trim(); if (name && !projects.includes(name)) {
    setProjects(xs => [...xs, name]);
    e.currentTarget.reset();
} }; return <section className="panel project-panel"><div className="section-title"><span>PROJECT LIBRARY</span><h2>项目库</h2><p>管理员在这里添加项目；实习生记录工作时只能从项目库中选择。</p></div><form className="project-add" onSubmit={add}><input required name="project" placeholder="输入新项目名称"/><button className="primary">＋ 添加项目</button></form><div className="project-list">{projects.map(project => <div key={project}><i style={projectStyle(project)}/><span>{project}</span><button onClick={() => setProjects(xs => xs.filter(x => x !== project))}>移除</button></div>)}{!projects.length && <div className="quiet-empty">还没有项目，请先添加。</div>}</div></section>; }
function AccessPanelLegacy({ users, interns, setUsers }: {
    users: User[];
    interns: Intern[];
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
}) { const update = (id: string, patch: Partial<User>) => setUsers(xs => xs.map(u => u.id === id ? { ...u, ...patch } : u)), toggleIntern = (u: User, internId: string) => update(u.id, { internIds: u.internIds.includes(internId) ? u.internIds.filter(id => id !== internId) : [...u.internIds, internId] }), members = users.filter(u => u.role !== "owner"), managerAccounts = members.filter(u => u.tag === "管理人"), removeAccount = (u: User) => {
    if (!window.confirm(`确定删除离职人员账号“${u.name}”吗？删除后无法恢复。`))
        return;
    setUsers(xs => {
        return xs.filter(x => x.id !== u.id);
    });
}, create = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget), username = String(d.get("username")).trim(); if (!username || users.some(u => u.username === username)) {
    alert("账号为空或已存在");
    return;
} const tag = String(d.get("tag")) as "实习生" | "管理人", u: User = { id: crypto.randomUUID(), name: String(d.get("name")).trim(), username, passwordHash: await hash(String(d.get("password"))), role: tag === "管理人" ? "admin" : "intern", approved: true, canManage: tag === "管理人", internIds: [], tag }; setUsers(xs => [...xs, u]); e.currentTarget.reset(); }; return <><section className="panel account-create"><div className="section-title"><span>CREATE ACCOUNT</span><h2>创建新账号</h2><p>账号只能由管理员主号创建，并在这里设置初始密码。</p></div><form onSubmit={create}><Field name="name" label="姓名"/><Field name="username" label="登录账号"/><Field name="password" label="初始密码" type="password"/><label>用户标签<select name="tag" defaultValue="实习生"><option>实习生</option><option>管理人</option></select></label><button className="primary">创建并允许登录</button></form></section><details className="collapsible-wrap" open><summary>用户标签与登录权限 <span>{users.length} 个账号</span></summary><section className="panel access-panel"><div className="section-title"><span>ACCOUNT CONTROL</span><h2>用户标签与登录权限</h2><p>标签改为“管理人”后自动获得管理权限，不再单独设置管理权限。</p></div><div className="access-list">{users.map(u => <div className="access-row account-permission-row compact-permission" key={u.id}><UserAvatar user={u}/><div><b>{u.name}</b><span>@{u.username}</span></div>{u.role === "owner" ? <strong className="owner-tag">管理员主号</strong> : <><label className="tag-select">用户标签<select value={u.tag} onChange={e => { const tag = e.target.value as "实习生" | "管理人"; update(u.id, { tag, canManage: tag === "管理人", role: tag === "管理人" ? "admin" : "intern" }); }}><option>实习生</option><option>管理人</option></select></label><label className="permission-switch"><input type="checkbox" checked={u.approved} onChange={e => update(u.id, { approved: e.target.checked })}/><span /><b>允许登录</b></label><button className="delete-account" onClick={() => removeAccount(u)}>删除账号</button></>}</div>)}</div></section></details><details className="collapsible-wrap" open><summary>授权实习生 <span>{managerAccounts.length} 位管理人</span></summary><section className="panel intern-authorization"><div className="section-title"><span>INTERN ACCESS</span><h2>授权实习生</h2><p>这里只显示标签为“管理人”的用户。被授权后，该管理人只能查看并评分所选实习生。</p></div><div className="authorization-list">{managerAccounts.map(u => <div key={u.id}><div className="authorization-user"><UserAvatar user={u}/><span><b>{u.name}</b><small>@{u.username}</small></span></div><div className="intern-checks">{interns.map(i => <label key={i.id}><input type="checkbox" checked={u.internIds.includes(i.id)} onChange={() => toggleIntern(u, i.id)}/>{i.name}</label>)}</div></div>)}{!managerAccounts.length && <div className="quiet-empty">暂时没有标签为“管理人”的用户。</div>}</div></section></details></>; }
function AccessPanel({ users, interns, acceptServerData }: {
    users: User[];
    interns: Intern[];
    acceptServerData: (data: SharedData) => void;
}) {
    const [savingId, setSavingId] = useState("");
    const members = users.filter(user => user.role !== "owner");
    const managerAccounts = members.filter(user => user.tag === "管理人");
    const managerNames = new Set(managerAccounts.map(user => user.name.trim()));
    const assignableInterns = interns.filter(intern => !managerNames.has(intern.name.trim()));

    const mutate = async (method: "POST" | "PATCH" | "DELETE", body: unknown, saving = "") => {
        setSavingId(saving);
        try {
            const response = await fetch("/api/accounts", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
            const payload = await response.json();
            if (!response.ok)
                throw new Error(payload.error || "保存失败");
            acceptServerData(payload.state);
            return true;
        } catch (error) {
            alert(error instanceof Error ? error.message : "保存失败，请重试");
            return false;
        } finally {
            setSavingId("");
        }
    };
    const update = (id: string, patch: Partial<User>) => mutate("PATCH", { id, patch }, id);
    const toggleIntern = (user: User, internId: string) => update(user.id, { internIds: user.internIds.includes(internId) ? user.internIds.filter(id => id !== internId) : [...user.internIds, internId] });
    const removeAccount = async (user: User) => {
        if (!window.confirm(`确定删除离职人员账号“${user.name}”吗？删除后无法恢复。`))
            return;
        await mutate("DELETE", { id: user.id }, user.id);
    };
    const create = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget, data = new FormData(form);
        const ok = await mutate("POST", {
            name: String(data.get("name")).trim(),
            username: String(data.get("username")).trim(),
            passwordHash: await hash(String(data.get("password"))),
            tag: String(data.get("tag")),
        }, "create");
        if (ok) {
            form.reset();
            alert("账号已写入共享数据库，现在可以在其他手机登录。");
        }
    };

    return <><section className="panel account-create"><div className="section-title"><span>CREATE ACCOUNT</span><h2>创建新账号</h2><p>创建后立即写入共享数据库；实习生会同时生成个人主页。</p></div><form onSubmit={create}><Field name="name" label="姓名"/><Field name="username" label="登录账号"/><Field name="password" label="初始密码" type="password"/><label>用户标签<select name="tag" defaultValue="实习生"><option>实习生</option><option>管理人</option></select></label><button className="primary" disabled={savingId === "create"}>{savingId === "create" ? "正在保存…" : "创建并允许登录"}</button></form></section>
    <details className="collapsible-wrap" open><summary>用户标签与登录权限 <span>{users.length} 个账号</span></summary><section className="panel access-panel"><div className="section-title"><span>ACCOUNT CONTROL</span><h2>用户标签与登录权限</h2><p>切换为“管理人”后，会立即清除其旧的实习生身份关联。</p></div><div className="access-list">{users.map(user => <div className="access-row account-permission-row compact-permission" key={user.id}><UserAvatar user={user}/><div><b>{user.name}</b><span>@{user.username}</span></div>{user.role === "owner" ? <strong className="owner-tag">管理员主号</strong> : <><label className="tag-select">用户标签<select disabled={savingId === user.id} value={user.tag} onChange={event => update(user.id, { tag: event.target.value as "实习生" | "管理人" })}><option>实习生</option><option>管理人</option></select></label><label className="permission-switch"><input disabled={savingId === user.id} type="checkbox" checked={user.approved} onChange={event => update(user.id, { approved: event.target.checked })}/><span/><b>允许登录</b></label><button className="delete-account" disabled={savingId === user.id} onClick={() => removeAccount(user)}>删除账号</button></>}</div>)}</div></section></details>
    <details className="collapsible-wrap" open><summary>授权实习生 <span>{managerAccounts.length} 位管理人</span></summary><section className="panel intern-authorization"><div className="section-title"><span>INTERN ACCESS</span><h2>授权实习生</h2><p>管理人不会出现在实习生选项中；勾选后立即同步到该管理人的主页。</p></div><div className="authorization-list">{managerAccounts.map(user => <div key={user.id}><div className="authorization-user"><UserAvatar user={user}/><span><b>{user.name}</b><small>@{user.username}</small></span></div><div className="intern-checks">{assignableInterns.map(intern => <label key={intern.id}><input disabled={savingId === user.id} type="checkbox" checked={user.internIds.includes(intern.id)} onChange={() => toggleIntern(user, intern.id)}/>{intern.name}</label>)}</div></div>)}{!managerAccounts.length && <div className="quiet-empty">暂时没有标签为“管理人”的用户。</div>}</div></section></details></>;
}

function AdminModal({ kind, current, evaluator, close, setInterns, created }: {
    kind: "intern" | "evaluation" | "problem";
    current?: Intern;
    evaluator: string;
    close: () => void;
    setInterns: React.Dispatch<React.SetStateAction<Intern[]>>;
    created: (i: Intern) => void;
}) { const submit = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget), id = crypto.randomUUID(); if (kind === "intern") {
    created(newIntern(String(d.get("name")), String(d.get("mentor"))));
    return;
} if (!current)
    return; setInterns(xs => xs.map(i => { if (i.id !== current.id)
    return i; if (kind === "problem")
    return { ...i, problems: [...i.problems, { id, title: String(d.get("title")), type: String(d.get("type")), severity: String(d.get("severity")) as "低" | "中" | "高" | "严重", repeats: Number(d.get("repeats")), solved: false }] }; const pts = (n: string) => Number(d.get(n)) * 20, date = new Date().toISOString().slice(0, 10); if (i.evaluations.some(e => e.date === date))
    return i; return { ...i, evaluations: [...i.evaluations, { id, label: `${date.slice(5).replace("-", ".")} 每日评分`, date, evaluator, scores: { video: pts("video"), edit: pts("edit"), promo: pts("promo"), aesthetic: pts("aesthetic"), final: pts("final") }, growth: pts("growth"), independence: pts("independence"), professionalism: pts("professionalism"), interventions: 0 }] }; })); close(); }; return <div className="modal-back"><form className={`modal ${kind === "evaluation" ? "wide-modal" : ""}`} onSubmit={submit}><ModalHead title={kind === "intern" ? "新增实习生" : kind === "problem" ? "记录问题" : `今日评分 · ${current?.name}`} close={close}/>{kind === "intern" && <><Field name="name" label="姓名"/><Field name="mentor" label="指导人（创建后仅主号可修改）" value="于勒"/></>} {kind === "problem" && <><Field name="title" label="问题描述"/><Field name="type" label="问题类型" value="镜头"/><label>严重程度<select name="severity"><option>低</option><option>中</option><option>高</option><option>严重</option></select></label><Field name="repeats" label="累计发生次数" type="number" value="1"/></>}{kind === "evaluation" && <><div className="evaluator-lock"><span>本次评分人</span><b>{evaluator}</b><small>提交后今日其他归属管理员不可重复评分</small></div><div className="rubric-list">{scoreKeys.map(([k, l]) => <RubricSelect key={k} name={k} label={l}/>)}</div><h3 className="subhead">工作方式</h3><div className="rubric-list"><RubricSelect name="growth" label="学习成长"/><RubricSelect name="independence" label="独立作业"/><RubricSelect name="professionalism" label="职业协作"/></div></>}<ModalActions close={close}/></form></div>; }
function AuthScreen({ login }: {
    login: (payload: { user: User; state: SharedData }) => void;
}) { const [error, setError] = useState(""), [submitting, setSubmitting] = useState(false); const submit = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); setSubmitting(true); setError(""); const d = new FormData(e.currentTarget), username = String(d.get("username")).trim(), passwordHash = await hash(String(d.get("password"))); try {
    const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, passwordHash }) });
    const payload = await response.json();
    if (!response.ok) {
        setError(payload.error || "账号或密码不正确");
        return;
    }
    login(payload);
} catch {
    setError("暂时无法连接云端，请稍后重试");
} finally {
    setSubmitting(false);
} }; return <main className="login-page"><section className="login-mark"><div className="bossmark"><i /><i /></div><b>白板BOSS</b><span>WHITEBOARD BOSS</span></section><form className="login-card" onSubmit={submit}><span>WELCOME BACK</span><h1>登录</h1><p>账号由管理员主号统一创建，可在任意设备登录。</p><Field name="username" label="账号"/><Field name="password" label="密码" type="password"/>{error && <div className="auth-error">{error}</div>}<button className="primary login-submit" disabled={submitting}>{submitting ? "正在连接云端…" : "登录"}</button></form></main>; }
function PendingAccess({ user, logout }: {
    user: User;
    logout: () => void;
}) { return <main className="pending-page"><div className="bossmark"><i /><i /></div><span>账号已注册</span><h1>等待管理员主号授权</h1><p>{user.name}，主号需要先把你的账号绑定到实习生档案。授权完成后重新登录，就能看到自己的任务日历啦。</p><button className="primary" onClick={logout}>返回登录</button></main>; }
function AccountPanel({ user, setUsers, close, logout }: {
    user: User;
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    close: () => void;
    logout: () => void;
}) { const [message, setMessage] = useState(""); const update = (patch: Partial<User>) => setUsers(xs => xs.map(x => x.id === user.id ? { ...x, ...patch } : x)); const password = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const d = new FormData(e.currentTarget); update({ passwordHash: await hash(String(d.get("password"))) }); setMessage("密码已更新"); }; const avatar = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file)
    return; const reader = new FileReader(); reader.onload = () => update({ avatar: String(reader.result) }); reader.readAsDataURL(file); }; return <div className="modal-back"><section className="modal account-panel"><ModalHead title="个人账户" close={close}/><div className="account-profile"><UserAvatar user={user}/><div><b>{user.name}</b><span>@{user.username}</span></div><label className="upload-button">更换头像<input type="file" accept="image/*" onChange={avatar}/></label></div><form onSubmit={password}><Field name="password" label="设置新密码" type="password"/><button className="soft-button">更新密码</button>{message && <span className="saved-message">{message}</span>}</form><button className="text-button logout-button" onClick={logout}>退出并切换账户</button></section></div>; }
function TrendChart({ evaluations }: {
    evaluations: Intern["evaluations"];
}) { const values = evaluations.map(e => production(e.scores)), coords = values.map((v, i) => ({ x: evaluations.length === 1 ? 50 : 8 + i * 84 / (evaluations.length - 1), y: 88 - v * .72 })); return <div className="trend-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="实习生评分进步折线图"><g className="chart-grid">{[16, 34, 52, 70, 88].map(y => <line key={y} x1="7" y1={y} x2="96" y2={y}/>)}</g>{coords.slice(1).map((p, i) => <line className={values[i + 1] < values[i] ? "regression-line" : "progress-line"} key={evaluations[i + 1].id} x1={coords[i].x} y1={coords[i].y} x2={p.x} y2={p.y}/>)}{coords.map((p, i) => <circle className={i > 0 && values[i] < values[i - 1] ? "regression-point" : ""} key={evaluations[i].id} cx={p.x} cy={p.y} r={i > 0 && values[i] < values[i - 1] ? 2.4 : 1.7}/>)}</svg><div className="trend-labels">{evaluations.map((e, i) => <span className={i > 0 && values[i] < values[i - 1] ? "regressed" : ""} key={e.id}>{e.date.slice(5).replace("-", ".")}<b>{values[i].toFixed(0)}</b></span>)}</div></div>; }
function projectStyle(project: string): React.CSSProperties { const colors = [{ color: "#073BFF", background: "#EAF0FF" }, { color: "#D14D72", background: "#FFEAF1" }, { color: "#6D43C5", background: "#F0EAFF" }, { color: "#008A72", background: "#E4F7F2" }, { color: "#C56B00", background: "#FFF1DA" }], index = Array.from(project).reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length; return colors[index]; }
function categoryStyle(category: string): React.CSSProperties { const styles: {
    [k: string]: React.CSSProperties;
} = { "剧宣预告": { color: "#8A3FFC", background: "#F1E9FF" }, "成片集数": { color: "#0066E6", background: "#E8F2FF" }, "资产图片": { color: "#00866A", background: "#E5F8F2" }, "其他": { color: "#B45F06", background: "#FFF0DA" } }; return styles[category] || styles["其他"]; }
function RubricSelect({ name, label }: {
    name: string;
    label: string;
}) { return <label className="rubric-select"><b>{label}</b><select name={name} defaultValue="3"><option value="1">1分 · 明显不达标</option><option value="2">2分 · 返工较多</option><option value="3">3分 · 能完成，仍需指导</option><option value="4">4分 · 达到正式生产要求</option><option value="5">5分 · 稳定独立且超预期</option></select></label>; }
function Field({ name, label, value = "", type = "text" }: {
    name: string;
    label: string;
    value?: string;
    type?: string;
}) { return <label className="field">{label}<input required name={name} type={type} defaultValue={value}/></label>; }
function ModalHead({ title, close }: {
    title: string;
    close: () => void;
}) { return <div className="modal-head"><div><span>WHITEBOARD BOSS</span><h2>{title}</h2></div><button type="button" onClick={close}>×</button></div>; }
function ModalActions({ close }: {
    close: () => void;
}) { return <div className="modal-actions"><button type="button" className="text-button" onClick={close}>取消</button><button className="primary">保存</button></div>; }
function Avatar({ i }: {
    i: Intern;
}) { return <div className="avatar" style={{ background: i.avatar }}>{i.avatar?.startsWith("data:") ? <img src={i.avatar} alt=""/> : i.name.slice(-1)}</div>; }
function UserAvatar({ user }: {
    user: User;
}) { return <div className="avatar user-avatar">{user.avatar ? <img src={user.avatar} alt=""/> : user.name.slice(-1)}</div>; }
function Grade({ g }: {
    g: string;
}) { return <span className={`grade g${g === "待" ? "Pending" : g}`}>{g}</span>; }
function Status({ yes, pending = false }: {
    yes: boolean;
    pending?: boolean;
}) { return <span className={`status ${pending ? "pending" : yes ? "yes" : "no"}`}>{pending ? "等待评估" : yes ? "建议留用" : "暂不留用"}</span>; }
