import { all } from "./db";
import { accountWeek, type AccountWeek } from "./account-weekly";
import { addDays, isoWeek, today, weekRange } from "./rules";
import { notify } from "./notify";
export function completedReviewWeek(asOf=today()) { return isoWeek(addDays(weekRange(isoWeek(asOf))[0],-7)); }
export function detectAccountSignals(s: AccountWeek) {
  const signals:{key:string;text:string}[]=[];
  if(s.is_complete_week && s.previous.published>=3 && s.current.published<=s.previous.published/2) signals.push({key:'output',text:`完整发布周的产出由${s.previous.published}条降至${s.current.published}条；请核对排期、休假和储备。`});
  const a=s.performance,b=s.previous_performance;
  // Only compare uniform, matching platform coverage; a change from two platforms
  // to one platform must not be presented as a performance drop.
  const profiles=new Set([...a.videos,...b.videos].filter(v=>v.plays_complete).map(v=>v.platforms.filter(p=>p!=="xhs").sort().join(",")));
  if(a.missing>0)signals.push({key:'missing',text:`已有${a.missing}条成熟作品缺少第7天数据，不能视作零播放或判断下滑。`});
  if(profiles.size===1 && a.complete>=3 && b.complete>=3 && !a.missing && !b.missing && a.average_plays!=null && b.average_plays!=null && b.average_plays>0 && a.average_plays<=b.average_plays/2)signals.push({key:'plays',text:`两个完整成熟样本组（${a.complete}/${b.complete}条）的平均第7天播放由${b.average_plays}降至${a.average_plays}；需排查题材与分发变化，不能归因员工能力。`});
  return signals;
}
export function accountSignals(accountId:number) {
  const week=completedReviewWeek(),snapshot=accountWeek(accountId,week);
  return snapshot?{week,snapshot,signals:detectAccountSignals(snapshot)}:null;
}
export async function notifyAccountAnomalies() {
  for(const a of all<{id:number;editor_id:number|null}>("SELECT id,editor_id FROM accounts WHERE editor_id IS NOT NULL")){
    const info=accountSignals(a.id);if(!info)continue;
    for(const signal of info.signals)await notify(a.editor_id,`账号周检查：${info.snapshot.account.name} · ${signal.text}`,`/weekly?account=${a.id}&week=${info.week}`,`account-signal-${a.id}-${info.week}-${signal.key}`);
  }
}
