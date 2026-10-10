/** 一条视频的流转图：四条泳道（编导 / 组长 / 剪辑 / 系统），两道审核关 */
export function FlowDiagram() {
  const W = 76, H = 40, c1 = 112, c2 = 208, c3 = 304, c4 = 400, c5 = 496, c6 = 592, c7 = 688;
  const yE = 100, yL = 180, yC = 260, yS = 340;
  const edge = "#a8a29e", grid = "#e7e5e4", accent = "#3370ff", ink = "#1c1917", quiet = "#78716c";
  const box = (cx: number, cy: number, label: string, main = false) => (
    <g>
      <rect x={cx - W / 2} y={cy - H / 2} width={W} height={H} rx={8} fill={main ? accent : "#fff"} fillOpacity={main ? 0.1 : 1} stroke={main ? accent : edge} strokeWidth={main ? 2 : 1.25} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontWeight={main ? 600 : 400} fill={ink}>{label}</text>
    </g>
  );
  const note = (x: number, y: number, s: string, anchor: "start" | "middle" | "end" = "middle") => (
    <text x={x} y={y} textAnchor={anchor} fontSize={11.5} fill={quiet}>{s}</text>
  );
  return (
    <svg viewBox="0 0 760 396" role="img" aria-label="一条视频的流转：两道审核关，打回都回到上一环节返工" className="w-full min-w-[640px]" fontSize={13}>
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={edge} />
        </marker>
      </defs>
      <text x={24} y={34} fontSize={15} fontWeight={600} fill={ink}>两道审核关，打回都回到上一环节返工</text>
      <g stroke={grid}>
        {[60, 140, 220, 300, 380].map((y) => <line key={y} x1={16} x2={744} y1={y} y2={y} />)}
      </g>
      {([["编导", yE], ["组长", yL], ["剪辑", yC], ["系统", yS]] as const).map(([n, y]) => (
        <text key={n} x={24} y={y + 5} fontWeight={600} fill={ink}>{n}</text>
      ))}
      <g fill="none" stroke={edge} strokeWidth={1.25} markerEnd="url(#flow-arrow)">
        <path d={`M${c1 + W / 2} ${yE}H${c2 - W / 2}`} />
        <path d={`M${c2 + W / 2} ${yE}H${c3}V${yL - H / 2}`} />
        <path d={`M${c3 + W / 2} ${yL}H${c4}V${yE + H / 2}`} />
        <path d={`M${c3 - W / 2} ${yL}H${c2}V${yE + H / 2}`} />
        <path d={`M${c4 + W / 2} ${yE}H${c5}V${yC - H / 2}`} />
        <path d={`M${c5 + W / 2} ${yC}H${c6}V${yE + H / 2}`} />
        <path d={`M${c6 - W / 2} ${yE}H520V${yC - H / 2}`} />
        <path d={`M${c6 + W / 2} ${yE}H${c7 - W / 2}`} />
        <path d={`M${c7} ${yE + H / 2}V${yS - 26}`} />
      </g>
      {box(c1, yE, "新建选题")}
      {box(c2, yE, "写脚本")}
      {box(c3, yL, "审脚本", true)}
      {box(c4, yE, "拍摄")}
      {box(c5, yC, "剪辑成片")}
      {box(c6, yE, "审成片", true)}
      {box(c7, yE, "登记发布")}
      <rect x={c7 - 44} y={yS - 26} width={88} height={52} rx={8} fill="#fff" stroke={edge} strokeWidth={1.25} />
      <text x={c7} y={yS - 4} textAnchor="middle" fill={ink}>自动定档</text>
      <text x={c7} y={yS + 14} textAnchor="middle" fill={ink}>算奖金</text>
      {note((c3 + W / 2 + c4) / 2, yL - 8, "通过")}
      {note((c2 + c3 - W / 2) / 2, yL - 8, "打回")}
      {note((c4 + W / 2 + c5) / 2, yE - 8, "交素材")}
      {note(c6 + 6, 200, "提交", "start")}
      {note(526, 176, "打回", "start")}
      {note(c7 - 8, 212, "第 7/30 天", "end")}
      {note(c7 - 8, 228, "登记播放", "end")}
      {note(112, 334, "每个阶段到期前一天、当天、逾期都会发飞书提醒", "start")}
      {note(112, 354, "发布后每天自动抓点赞、评论、收藏、分享", "start")}
    </svg>
  );
}
